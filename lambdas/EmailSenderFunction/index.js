/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();
const datefns = require('date-fns');
const ja = require('date-fns/locale/ja');
const { format } = require('date-fns');

process.env.TZ = "Asia/Tokyo";
process.env.AWS_REGION = "ap-northeast-1";

const REGEXP_REPLACE_TAG = /\[%.*?%\]/gm;

const PREFIX_REPLACE_TAG = "[%";
const SUFFIX_REPLACE_TAG = "%]";

/**
 * EmailSenderFunction.
 * 
 * @param {*} event 
 * @returns {json} response
 */
exports.handler = async (event, context) => {
    console.log("Event data:", event);
    let logAccountId;
    // Reading encrypted environment variables --- required
    if (process.env.DBINFO == null) {
        const ssmreq = {
            Name: 'DBINFO_' + process.env.ENV,
            WithDecryption: true,
        };
        const ssmparam = await ssm.getParameter(ssmreq).promise();
        const dbinfo = JSON.parse(ssmparam.Parameter.Value);
        process.env.DBWRITEENDPOINT = dbinfo.DBWRITEENDPOINT;
        process.env.DBREADENDPOINT = dbinfo.DBREADENDPOINT;
        process.env.DBUSER = dbinfo.DBUSER;
        process.env.DBPASSWORD = dbinfo.DBPASSWORD;
        process.env.DBDATABSE = dbinfo.DBDATABSE;
        process.env.DBPORT = dbinfo.DBPORT;
        process.env.DBCHARSET = dbinfo.DBCHARSET;
        process.env.DBINFO = true;
    }

    // Database info
    const readDbConfig = {
        host: process.env.DBREADENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET
    };

    // mysql connect
    let mysql_con;
    try {
        let param;
        if (event?.body) {
            param = JSON.parse(event.body);
        } else {
            param = event;
        }
        let appId = param.appId;
        let eventId = param.eventId;
        let eventCategoryId = param.eventCategoryId;
        let emailTemplateTypeFlag = param.emailTemplateTypeFlag;
        let customerId = param.customerId;
        let reservationNo = param.reservationNo;
        // console.log("========appId", appId);
        // console.log("========eventId", eventId);
        // console.log("========emailTemplateTypeFlag", emailTemplateTypeFlag);
        // console.log("========customerId", customerId);

        logAccountId = param.accountId !== undefined ? param.accountId : 'システム';
        let contentsText;
        if (emailTemplateTypeFlag === 1) {
            contentsText = '予約完了';
        } else if (emailTemplateTypeFlag === 2) {
            contentsText = '再送';
        } else if (emailTemplateTypeFlag === 3) {
            contentsText = 'リマインド';
        } else if (emailTemplateTypeFlag === 4) {
            contentsText = '予約変更完了';
        } else if (emailTemplateTypeFlag === 5) {
            contentsText = '予約キャンセル完了';
        }
        console.log("========contentsText", contentsText);

        if ((appId === undefined && eventId === undefined && eventCategoryId === undefined) || emailTemplateTypeFlag === undefined || customerId === undefined || reservationNo === undefined) {
            await createLog(context, 'メール送信', contentsText, '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, eventId, customerId, null);
            return {
                statusCode: 400,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "*",
                },
                body: JSON.stringify({
                    "message": "invalid parameter"
                }),
            };
        }

        // console.log("projectId", projectId);

        if (!Array.isArray(customerId)) {
            customerId = [customerId];
        }
        if (!Array.isArray(reservationNo)) {
            reservationNo = [reservationNo];
        }

        let sql_param_email = [];
        // get email template
        let sql_data_email = '';

/*
        if (appId) {
            sql_data_email = `SELECT
                Event.eventId,
                Event.categoryId,
                Event.projectId,
                EmailTemplate.emailTemplateFrom,
                EmailTemplate.emailTemplateSubject,
                EmailTemplate.emailTemplateBody
            FROM
                APP
                INNER JOIN Event ON
                    App.eventId = Event.eventId
                INNER JOIN EmailTemplate ON
                    Event.eventId = EmailTemplate.emailTemplateEventId
                INNER JOIN Category ON
                    EmailTemplate.categoryId = Catgory.categoryId
            WHERE
                App.appId = ?
                AND EmailTemplate.emailTemplateTypeFlag = ?`;

            // set query param
            sql_param_email.push(appId);
            sql_param_email.push(emailTemplateTypeFlag);
        }
        else {
*/
            sql_data_email = `SELECT 
                Event.eventId,
                EventCategory.eventCategoryId,
                Event.projectId,
                EmailTemplate.emailTemplateFrom,
                EmailTemplate.emailTemplateSubject,
                EmailTemplate.emailTemplateBody
            FROM
                Event
                INNER JOIN EventCategory ON
                    Event.eventId = EventCategory.eventId
                INNER JOIN EmailTemplate ON
                    EventCategory.eventCategoryId = EmailTemplate.eventCategoryId
            WHERE
                Event.eventId = ?
                AND EventCategory.eventCategoryId = ?
                AND EmailTemplate.emailTemplateTypeFlag = ?`;

            // set query param
            sql_param_email.push(eventId);
            sql_param_email.push(eventCategoryId);
            sql_param_email.push(emailTemplateTypeFlag);
        // }

        console.log("sql_data_email", sql_data_email);
        console.log("sql_param_email", sql_param_email);

        // mysql connect
        mysql_con = await mysql.createConnection(readDbConfig);
        await mysql_con.beginTransaction();

        // execute query
        let [query_result_email] = await mysql_con.query(sql_data_email, sql_param_email);
        if (query_result_email.length === 0) {
            // no email template
            console.log("***************************** no email template");
            await createLog(context, 'メール送信', contentsText, '失敗', '200', event.requestContext.identity.sourceIp, logAccountId, eventId, customerId, null);
            return {
                statusCode: 200,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "*",
                },
                body: JSON.stringify("no email template"),
            };
        }

        // email body for each customer
        let emailBodyForEachCustomer = {};
        console.log("query_result_email", query_result_email);
        // get query result
        let emailTemplateFrom = query_result_email[0].emailTemplateFrom;
        let emailTemplateSubject = query_result_email[0].emailTemplateSubject;
        let emailTemplateBody = query_result_email[0].emailTemplateBody;
        // eventId = query_result_email[0].eventId;
        let projectId = query_result_email[0].projectId;

        // get replace tag list
        let replaceTagList = emailTemplateBody.match(REGEXP_REPLACE_TAG);


        // 検索用データ
        let customerReservation = [];
        // console.log("customerId", customerId);
        // console.log("reservationNo", reservationNo);
        for (let j = 0; j < customerId.length; j++) {
            let row = [];
            row.push(customerId[j]);
            row.push(reservationNo[j]);
            customerReservation.push(row);
        }
        // console.log("customerReservation", customerReservation);


        // if regular expressions are not used === null
        // Email body contains replacement tags
        if (replaceTagList !== null) {
            let emailFieldCodeList = replaceTagList.map(tag => {
                // exclude prefixes, suffixes
                return tag.replace(PREFIX_REPLACE_TAG, "").replace(SUFFIX_REPLACE_TAG, "");
            });
            // console.log('emailFieldCodeList', emailFieldCodeList);

            let sql_param_fields = [];
            // get field list
            const sql_data_fields = `SELECT * FROM Field WHERE fieldCode IN (?) AND (projectId = 0 OR projectId = ?)`;
            // set query param
            sql_param_fields.push(emailFieldCodeList);
            sql_param_fields.push(projectId);

            console.log("sql_data_fields", sql_data_fields);
            console.log("sql_param_fields", sql_param_fields);

            // execute query
            let [query_result_fields] = await mysql_con.query(sql_data_fields, sql_param_fields);
            // get field list
            let fieldList = query_result_fields;

            // complete model of the object something like this
            //
            // let map = (
            //     customerId : [
            //         {"replaceTag_aaa": 1234},
            //         {"replaceTag_bbb": "hello"},
            //         {"replaceTag_ccc": "world"},
            //         {"replaceTag_ddd": 999}
            //        ],
            //     customerId : [
            //         {"replaceTag_aaa": 1234},
            //         {"replaceTag_bbb": "hello"},
            //         {"replaceTag_ccc": "world"},
            //         {"replaceTag_ddd": 999}
            //        ]
            // )

            // Map of replacement tags and values. key=customerId value={replace tag: replace value}
            let replaceTagValueMap = new Map();
            for (var id in customerId) {
                replaceTagValueMap.set(Number.parseInt(customerId[id], 10), []);
            }
            // get replace tag value
            for (var i = 0; i < emailFieldCodeList.length; i++) {
// console.log("xxxxx---i=", i);
                let fCode = emailFieldCodeList[i];
                let row = fieldList.find(field => field.fieldCode == fCode);
                if (!row) {
                    if (fCode == 'now') {
                        for (var id in customerId) {
                            let array = replaceTagValueMap.get(customerId[id]);
                            let now = format(new Date(), 'yyyy年M月d日 HH時mm分', { locale: ja });
                            array.push({ ['[%now%]']: now });
                        }
                    }
                    continue;
                }
                // Since the field code list and replacement tag list are the same length, get from the replacement tag list
                let replaceTag = replaceTagList[i];

                let sal_data_value;
                let sql_param_value = [];
                // special field ==================================================
                if (row.fieldColumnName) {
                    // get special field value query
// console.log("customerReservation", customerReservation);

                    sal_data_value = `SELECT Customer.customerId, ${row.fieldColumnName} AS value FROM Customer LEFT OUTER JOIN Reservation ON Customer.customerId = Reservation.customerId 
                        WHERE (Customer.customerId, Reservation.reservationNo) IN (?)`;
                    sql_param_value.push(customerReservation);
                    // sql_param_value.push(reservationNo);

// console.log("sal_data_value", sal_data_value);
// console.log("sql_param_value", sql_param_value);

                    // execute query
                    let [query_result_value] = await mysql_con.query(sal_data_value, sql_param_value);
                    let customerList = query_result_value;

                    // if the number of retrieved records is different
                    if (customerId.length !== customerList.length) {
                        // need to do something
                        //WARNING:
                    }

// console.log("sqldata customerList = ", customerList);
                    // console.log("===============replaceTagValueMap", replaceTagValueMap)
                    // iterate through the customer list
                    for (var j = 0; j < customerList.length; j++) {

                        let array = replaceTagValueMap.get(customerList[j].customerId);
                        let val = (customerList[j].value !== null) ? customerList[j].value : "";

// console.log("row", row);
// console.log("val", val);


                        switch (row.fieldType) {
                            case 0: // text type
                            case 1: // textarea type
                            case 2: // combine text type
                                // console.log("============ customerFieldText" + row.customerFieldText)
                                // 予約番号
                                if (row.fieldCode == "reservationNo") {
                                    val = val.substring(0, 4) + "-" + val.substring(4, 8) + "-" + val.substring(8, 12);
                                }
                                // 被保険者番号
                                else if (row.fieldCode == "insuredPersonNo") {
                                    const cha = String(val);
                                    const visible = cha.slice(-3);
                                    val = visible.padStart(cha.length, "*");                                    
                                }
                                break;
                            case 3: // list type
                                // get list value. format is something like this >>>> ["b4d4e8f1","944f7abf"]
                                let listJson = val;
                                val = '';
                                // let arr = JSON.parse(json);
                                for (var k = 0; k < listJson.length; k++) {
                                    // get field code
                                    var fieldCode = listJson[k];
                                    // Find matching fieldListCode from fieldStyle
                                    row?.fieldStyle?.lookup?.map(item => {
// console.log("item", item);
                                        if (fieldCode.id == item.fieldListCode) {
                                            if (val.length === 0) {
                                                val += item.inputBox2.value;
                                            } else {
                                                val += ", " + item.inputBox2.value;
                                            }
                                        }
                                    });
// console.log("fieldCode", fieldCode);
// console.log("val", val);
                                }
                                break;
                            case 4: // yes/no type
                                let boolVal = val;
                                if (boolVal) {
                                    val = row.fieldStyle.trueText;
                                } else {
                                    val = row.fieldStyle.falseText;
                                }
                                break;
                            case 5: // date type
                                // 受診日 曜日を追加
                                if(row.fieldCode == "reservationReceiveDatetime") {
                                    const date = new Date(val * 1000);
                                    val = datefns.format(date, "yyyy年M月d日（E）", { locale: ja });
                                }
                                else {
                                    const date = new Date(val * 1000);
                                    val = datefns.format(date, "yyyy年M月d日", { locale: ja });
                                }
                                break;
                            case 6: // time type
                                if (val == 0) {
                                    val = "0:00";
                                }
                                else {
                                    const hour = (String(val).length == 3)? String(val).substring(0, 1): String(val).substring(0, 2);
                                    const minutes = (String(val).length == 3)? String(val).substring(1, 3): String(val).substring(2, 4);
                                    val = `${hour}:${minutes}`;
                                }
                                break;
                            case 7: // number type
                                val = val.toLocaleString();
                                // code
                                break;
                            default:
                                console.log("============ invalid field type ============");
                                break;
                        }
                        // if (val.trim() == "") {
                        //     val = "ー"
                        // }
                        array.push({ [replaceTag]: val });
                    }
                }
                // custom field ==================================================
                else {
                    // get custom field value query
                    sal_data_value = `SELECT
                        CustomerField.customerId,
                        CustomerField.CustomerFieldId,
                        CustomerField.customerFieldText,
                        CustomerField.customerFieldList,
                        CustomerField.customerFieldBoolean,
                        CustomerField.customerFieldInt,
                        Field.fieldId,
                        Field.projectId,
                        Field.fieldCode,
                        Field.fieldType,
                        Field.fieldStyle,
                        Field.fieldGroupId
                    FROM
                        CustomerField
                        INNER JOIN Field
                            ON CustomerField.fieldId = Field.fieldId
                        INNER JOIN Reservation
                            ON CustomerField.reservationNo = Reservation.reservationNo
                    WHERE
                        CustomerField.fieldId = ${row.fieldId}
                        AND (CustomerField.customerId, Reservation.reservationNo) IN (?)`;
                    sql_param_value.push(customerReservation);

                    console.log("sal_data_value", sal_data_value);
                    console.log("sql_param_value", sql_param_value);

                    // execute query
                    let [query_result_value] = await mysql_con.query(sal_data_value, sql_param_value);
                    let customerFieldArray = query_result_value;

                    // if the number of retrieved records is different
                    if (customerId.length !== customerFieldArray.length) {
                        // need to do something
                        //WARNING:
                    }

                    // iterate through the customer field list
                    for (var j = 0; j < customerFieldArray.length; j++) {
                        let row = customerFieldArray[j];
console.log("============ customerFieldArray" + JSON.stringify(row));
                        let val = '';
                        switch (row.fieldType) {
                            case 0: // text type
                            case 1: // textarea type
                            case 2: // combine text type
                                // console.log("============ customerFieldText" + row.customerFieldText)
                                val = row.customerFieldText;
                                break;
                            case 3: // list type
                                // get list value. format is something like this >>>> ["b4d4e8f1","944f7abf"]
                                let listJson = row.customerFieldList;
                                // let arr = JSON.parse(json);
                                for (var k = 0; k < listJson.length; k++) {
                                    // get field code
                                    var fieldCode = listJson[k];
                                    // Find matching fieldListCode from fieldStyle
                                    row?.fieldStyle?.lookup?.map(item => {
                                        if (fieldCode == item.fieldListCode) {
                                            if (val.length === 0) {
                                                val += item.inputBox2.value;
                                            } else {
                                                val += ", " + item.inputBox2.value;
                                            }
                                        }
                                    });
                                }
                                break;
                            case 4: // yes/no type
                                let boolVal = row.customerFieldBoolean;
                                if (boolVal) {
                                    val = row.fieldStyle.trueText;
                                } else {
                                    val = row.fieldStyle.falseText;
                                }
                                break;
                            case 5: // date type
                                val = row.customerFieldInt;
                                break;
                            case 6: // time type
                                val = row.customerFieldInt;
                                if (val == 0) {
                                    val = "0:00";
                                }
                                else {
                                    const hour = (String(val).length == 3)? String(val).substring(0, 1): String(val).substring(0, 2);
                                    const minutes = (String(val).length == 3)? String(val).substring(1, 3): String(val).substring(2, 4);
                                    val = `${hour}:${minutes}`;
                                }
                                break;
                            case 7: // number type
                                val = row.customerFieldInt;
                                // code
                                break;
                            default:
                                console.log("============ invalid field type ============");
                                break;
                        }

                        let array = replaceTagValueMap.get(customerFieldArray[j].customerId);
                        array.push({ [replaceTag]: val });
                    }
// console.log("============ array" + JSON.stringify(array))
                }
            }
console.log("===============replaceTagValueMap", replaceTagValueMap);

            // processing to replace replacement tags in the email body for each customer
            replaceTagValueMap.forEach((value, key) => {
                let emailText = emailTemplateBody;
                for (var i = 0; i < value.length; i++) {
                    var obj = value[i];
                    for (const [k, v] of Object.entries(obj)) {
                        if (v != null) {
                            emailText = emailText.replace(k, v);
                        }
                    }
                }
                // append to per-customer email body object
                emailBodyForEachCustomer[key] = emailText;
            });
        }
        // Email body does not contain replacement tags
        else {
            for (var i = 0; i < customerId.length; i++) {
                // append to per-customer email body object
                emailBodyForEachCustomer[customerId] = emailTemplateBody;
            }
        }
        // console.log("===============emailBodyForEachCustomer", emailBodyForEachCustomer)

        // console.log("emailBodyForEachCustomer", emailBodyForEachCustomer)
        // get special field value query
        let sal_data_customer = `SELECT
                Customer.customerId,
                Customer.emailAddress,
                Customer.deliveryEmailAddress,
                Reservation.reservationEmailAddress
            FROM
                Customer
                INNER JOIN Reservation
                    ON Reservation.customerId = Customer.customerId
            WHERE
                (Customer.customerId, Reservation.reservationNo) IN (?)`;
        // console.log("===============emailBodyForEachCustomer", Object.keys(emailBodyForEachCustomer))

        let keys = Object.keys(emailBodyForEachCustomer);
        // execute query
        // let [query_result_customer] = await mysql_con.query(sal_data_customer, [keys]);
        let [query_result_customer] = await mysql_con.query(sal_data_customer, [customerReservation]);

        console.log("===============customerReservation", customerReservation);
        console.log("===============query_result_customer", query_result_customer);
        // Send repeated emails
        for (var i = 0; i < query_result_customer.length; i++) {
            var textBody = emailBodyForEachCustomer[query_result_customer[i].customerId];
            let emaiiAddress;
            if (query_result_customer[i].emailAddress) {
                emaiiAddress = query_result_customer[i].emailAddress;
            }
            else if (query_result_customer[i].reservationEmailAddress) {
                emaiiAddress = query_result_customer[i].reservationEmailAddress;
            }
            else {
                emaiiAddress = query_result_customer[i].deliveryEmailAddress;
            }
            await exports.sendEmail(emaiiAddress, emailTemplateSubject, textBody, emailTemplateFrom);
            await createLog(context, 'メール送信', contentsText, '成功', '200', event.requestContext?.identity?.sourceIp, logAccountId, eventId, query_result_customer[i].customerId, null);
        }

        // construct the response
        let response = {
            result: "success"
        };
        console.log("response:", response);
        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "*",
            },
            body: JSON.stringify(response),
        };
    } catch (error) {
        console.log(error);
        await createLog(context, 'メール送信', '送信', '失敗', '400', event.requestContext?.identity?.sourceIp, logAccountId, null, null, null);
        return {
            statusCode: 400,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "*",
            },
            body: JSON.stringify(error),
        };
    } finally {
        if (mysql_con) await mysql_con.close();
    }
};

async function createLog(context, _target, _type, _result, _code, ipAddress, accountId, eventId, customerId, logData) {
    let params = {
        FunctionName: "createLog-" + process.env.ENV,
        InvocationType: "Event",
        Payload: JSON.stringify({
            logGroupName: context.logGroupName,
            logStreamName: context.logStreamName,
            _target: _target,
            _type: _type,
            _result: _result,
            _code: _code,
            ipAddress: ipAddress,
            accountId: accountId,
            eventId: eventId,
            customerId: customerId,
            logData: logData
        }),
    };
    await lambda.invoke(params).promise();
}

/**
 * sendEmail
 * 
 * @param {string} to - destination address
 * @param {string} subject
 * @param {string} body - email body text
 * @param {string} source sender
 * @returns {json} response
 */
exports.sendEmail = async (to, subject, body, source) => {
    console.log("==================== email")
    // E-mail setting
    let emailParams = {
        Destination: {
            ToAddresses: [to],
        },
        Message: {
            Subject: { Data: subject },
            Body: {
                Text: { Data: body },
            }
        },
        Source: source
    };

    let payload = JSON.stringify(emailParams);
    console.log(payload);
    let invokeParams = {
        FunctionName: "sendMail-" + process.env.ENV,
        InvocationType: "Event",
        Payload: payload
    };
    // invoke lambda
    let result = await lambda.invoke(invokeParams).promise();
    // console.log("==========result", result)
    if (result.$response.error) throw (500, result.$response.error.message);

    return result;
};