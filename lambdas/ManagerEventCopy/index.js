/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerEventCopy.
 * 
 * @param {*} event 
 * @returns {json} response
 */
exports.handler = async (event, context) => {
    console.log("Event data:", event);
    let logData = [];
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
    const writeDbConfig = {
        host: process.env.DBWRITEENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET,
    };

    const projectId = event.projectId;
    const eventId = Number(event.eventId);
    const newEventId = event.newEventId;
    const createdBy = event.createdBy;
    const createdAt = event.createdAt;

    let mysql_con;
    try {
        mysql_con = await mysql.createConnection(writeDbConfig);
        await mysql_con.beginTransaction();

        // get event category data
        let param_event_category = [];
        const sql_event_category = `SELECT * FROM EventCategory WHERE eventId = ?`;
        param_event_category.push(eventId);
        let [result_event_category] = await mysql_con.query(sql_event_category, param_event_category);
        // console.log("result_event_category.length", result_event_category.length);
        if (result_event_category) {
            for (let i = 0; i < result_event_category.length; i++) {
                const element2 = result_event_category[i];
                const event_category_categoryId = element2.categoryId;
                const event_category_eventCategoryId = element2.eventCategoryId;
                const event_category_eventCategoryName = element2.eventCategoryName;
                const event_category_eventCategoryStartDate = element2.eventCategoryStartDate;
                const event_category_eventCategoryEndDate = element2.eventCategoryEndDate;
                const event_category_filterId = element2.filterId;
                const event_category_memo = element2.memo;
                // insert data query
                let sql_event_category_copy = `INSERT INTO EventCategory (
                    eventId,
                    categoryId,
                    eventCategoryName,
                    eventCategoryStartDate,
                    eventCategoryEndDate,
                    filterId,
                    memo,
                    createdAt,
                    createdBy,
                    updatedAt,
                    updatedBy
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`;
                let param_event_category_copy = [
                    newEventId,
                    event_category_categoryId,
                    event_category_eventCategoryName,
                    event_category_eventCategoryStartDate,
                    event_category_eventCategoryEndDate,
                    event_category_filterId,
                    event_category_memo,
                    createdAt,
                    createdBy,
                    createdAt,
                    createdBy,
                ];
                // console.log("sql_event_category_copy:", sql_event_category_copy);
                // console.log("param_event_category_copy:", param_event_category_copy);
                const [result_copy_event_category] = await mysql_con.execute(sql_event_category_copy, param_event_category_copy);
                let newEventCategoryId = result_copy_event_category.insertId;

                // get event institute data
                let param_event_institute = [];
                const sql_event_institute = `SELECT * FROM EventInstitute WHERE eventCategoryId = ?`;
                param_event_institute.push(result_event_category[i].eventCategoryId);
                let [result_event_institute] = await mysql_con.query(sql_event_institute, param_event_institute);
                // console.log("result_event_institute.length", result_event_institute.length);
                if (result_event_institute) {
                    for (let j = 0; j < result_event_institute.length; j++) {
                        const element3 = result_event_institute[j];
                        const event_institute_instituteId = element3.instituteId;
                        const event_institute_eventInstituteName = element3.eventInstituteName;
                        const event_institute_eventInstituteItemType = element3.eventInstituteItemType;
                        const event_institute_eventInstituteStartDate = element3.eventInstituteStartDate;
                        const event_institute_eventInstituteEndDate = element3.eventInstituteEndDate;
                        const event_institute_filterId = element3.filterId;
                        const event_institute_eventInstituteDentalFlag = element3.eventInstituteDentalFlag;
                        const event_institute_eventInstituteSlotType = element3.eventInstituteSlotType;
                        const event_institute_eventInstituteSlotStyle = element3.eventInstituteSlotStyle;
                        const event_institute_eventInstituteItemInfo = element3.eventInstituteItemInfo;
                        const event_institute_eventInstituteItemStyle = element3.eventInstituteItemStyle;
                        const event_institute_eventInstituteBusStyle = element3.eventInstituteBusStyle;
                        const event_institute_memo = element3.memo;
                        const event_institute_memo2 = element3.memo2;
                        const event_institute_memo3 = element3.memo3;
                        // insert data query
                        let sql_event_institute_copy = `INSERT INTO EventInstitute (
                            eventCategoryId,
                            instituteId,
                            eventInstituteName,
                            eventInstituteItemType,
                            eventInstituteStartDate,
                            eventInstituteEndDate,
                            filterId,
                            eventInstituteDentalFlag,
                            eventInstituteSlotType,
                            eventInstituteSlotStyle,
                            eventInstituteMappingStyle,
                            eventInstituteItemInfo,
                            eventInstituteItemStyle,
                            eventInstituteBusStyle,
                            memo,
                            memo2,
                            memo3,
                            createdAt,
                            createdBy,
                            updatedAt,
                            updatedBy
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`;
                        let param_event_institute_copy = [
                            newEventCategoryId,
                            event_institute_instituteId,
                            event_institute_eventInstituteName,
                            event_institute_eventInstituteItemType,
                            event_institute_eventInstituteStartDate,
                            event_institute_eventInstituteEndDate,
                            event_institute_filterId,
                            event_institute_eventInstituteDentalFlag,
                            event_institute_eventInstituteSlotType,
                            event_institute_eventInstituteSlotStyle,
                            null,
                            event_institute_eventInstituteItemInfo,
                            event_institute_eventInstituteItemStyle,
                            event_institute_eventInstituteBusStyle,
                            event_institute_memo,
                            event_institute_memo2,
                            event_institute_memo3,
                            createdAt,
                            createdBy,
                            createdAt,
                            createdBy
                        ];
                        // console.log("sql_event_institute_copy:", sql_event_institute_copy);
                        // console.log("param_event_institute_copy:", param_event_institute_copy);
                        const [result_copy_event_institute] = await mysql_con.execute(sql_event_institute_copy, param_event_institute_copy);
                        let newEventInstituteId = result_copy_event_institute.insertId;
                    } // end for event institute
                }

                // get email template data
                let param_email_template = [];
                const sql_email_template = `SELECT * FROM EmailTemplate WHERE eventId = ? AND eventCategoryId = ?`;
                param_email_template.push(eventId);
                param_email_template.push(event_category_eventCategoryId);
                let [result_email_template] = await mysql_con.query(sql_email_template, param_email_template);

                if (result_email_template.length !== 0) {
                    // make email template insert parameters
                    let placeholderEmailTemplate = "";
                    let valuesEmailTemplate = [];
                    for (let index = 0; index < result_email_template.length; index++) {
                        const element = result_email_template[index];
                        valuesEmailTemplate.push(newEventId);
                        valuesEmailTemplate.push(newEventCategoryId);
                        valuesEmailTemplate.push(element.emailTemplateTypeFlag);
                        valuesEmailTemplate.push(element.emailTemplateFrom);
                        valuesEmailTemplate.push(element.emailTemplateSubject);
                        valuesEmailTemplate.push(element.emailTemplateBody);
                        valuesEmailTemplate.push(element.memo);
                        valuesEmailTemplate.push(createdAt);
                        valuesEmailTemplate.push(createdBy);
                        valuesEmailTemplate.push(createdAt);
                        valuesEmailTemplate.push(createdBy);
                        placeholderEmailTemplate += "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),";
                    }
                    // delete last comma
                    placeholderEmailTemplate = placeholderEmailTemplate.slice(0, -1);
                    // insert data query
                    let sql_email_template_copy = `INSERT INTO EmailTemplate (
                        eventId,
                        eventCategoryId,
                        emailTemplateTypeFlag,
                        emailTemplateFrom,
                        emailTemplateSubject,
                        emailTemplateBody,
                        memo,
                        createdAt,
                        createdBy,
                        updatedAt,
                        updatedBy
                        ) VALUES ${placeholderEmailTemplate};`;
                    // console.log("sql_email_template_copy:", sql_email_template_copy);
                    await mysql_con.execute(sql_email_template_copy, valuesEmailTemplate);
                }

                // get sms template data
                let param_sms_template = [];
                const sql_sms_template = `SELECT * FROM SMSTemplate WHERE eventId = ? AND eventCategoryId = ?`;
                param_sms_template.push(eventId);
                param_sms_template.push(event_category_eventCategoryId);
                let [result_sms_template] = await mysql_con.query(sql_sms_template, param_sms_template);

                if (result_sms_template.length !== 0) {
                    // make sms template insert parameters
                    let placeholderSMSTemplate = "";
                    let valuesSMSTemplate = [];
                    for (let index = 0; index < result_sms_template.length; index++) {
                        const element = result_sms_template[index];
                        valuesSMSTemplate.push(newEventId);
                        valuesSMSTemplate.push(newEventCategoryId);
                        valuesSMSTemplate.push(element.smsTemplateTypeFlag);
                        valuesSMSTemplate.push(element.smsTemplateFrom);
                        valuesSMSTemplate.push(element.smsTemplateSubject);
                        valuesSMSTemplate.push(element.smsTemplateBody);
                        valuesSMSTemplate.push(element.memo);
                        valuesSMSTemplate.push(createdAt);
                        valuesSMSTemplate.push(createdBy);
                        valuesSMSTemplate.push(createdAt);
                        valuesSMSTemplate.push(createdBy);
                        placeholderSMSTemplate += "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),";
                    }
                    // delete last comma
                    placeholderSMSTemplate = placeholderSMSTemplate.slice(0, -1);
                    // insert data query
                    let sql_sms_template_copy = `INSERT INTO SMSTemplate (
                        eventId,
                        eventCategoryId,
                        smsTemplateTypeFlag,
                        smsTemplateFrom,
                        smsTemplateSubject,
                        smsTemplateBody,
                        memo,
                        createdAt,
                        createdBy,
                        updatedAt,
                        updatedBy
                        ) VALUES ${placeholderSMSTemplate};`;
                    // console.log("sql_sms_template_copy:", sql_sms_template_copy);
                    await mysql_con.execute(sql_sms_template_copy, valuesSMSTemplate);
                }
            } // end for event category
        }

        console.log("==================== event copy finished");

        await mysql_con.commit();
    } catch (error) {
        await mysql_con.rollback();
        console.log("error:", error);
        // failure log
        await createLog(context, 'イベント', '複製', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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

async function createLog(context, _target, _type, _result, _code, ipAddress, projectId, accountId, logData = null) {
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
            projectId: projectId,
            accountId: accountId,
            logData: logData
        }),
    };
    await lambda.invoke(params).promise();
}