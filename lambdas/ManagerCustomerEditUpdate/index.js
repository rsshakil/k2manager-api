/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerCustomerEditUpdate.
 * 
 * @param {*} event 
 * @returns {json} response
 */
exports.handler = async (event, context) => {
    // console.log("Event data:", event);
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
    const {
        projectId,
        customerEditTemplateName,
        customerEditTemplateColumn,
        customerEditTemplateTypeFlag,
        customerEditTemplateQuery,
        customerEditTemplateAuthRole,
        memo,
        createdBy,
        updatedBy,
        updateFieldList,
        formData,
        customerId,
        eventId,
        reservationId,
    } = JSON.parse(event.body);
    logAccountId = updatedBy;
    let mysql_con;
    try {
        // mysql connect
        mysql_con = await mysql.createConnection(writeDbConfig);
        // let customerEditTemplateId = event.pathParameters?.customerEditTemplateId;
        // console.log("customerEditTemplateId:", customerEditTemplateId);
        // Expand GET parameters
        let jsonBody = event.queryStringParameters;
        // console.log("event.queryStringParameters:", jsonBody);
        // created date
        const createdAt = Math.floor(new Date().getTime() / 1000);
        const changer = (JSON.parse(event.body)?.updatedBy) ? JSON.parse(event.body).updatedBy : "本人";
        if (!projectId) {
            let error = "invalid parameter. Project ID not found.";
            // failure log
            await createLog(context, '顧客編集', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(error),
            };
        }
        let validProjectId;
        if (event?.requestContext?.authorizer?.pid) {
            validProjectId = JSON.parse(event?.requestContext?.authorizer?.pid)
            // pidがない場合　もしくは　許可プロジェクトIDに含まれていない場合
            if (!projectId || validProjectId.indexOf(Number(projectId)) == -1) {
                // failure log
                await createLog(context, '顧客編集', '更新', '失敗', '403', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
                return {
                    statusCode: 403,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': '*',
                    },
                    body: JSON.stringify("Unauthorized"),
                }
            }
        }

        await mysql_con.beginTransaction();
        console.log('-----------------------------');
        console.log(updateFieldList);
        let getCustomerTableFieldKeyValue = updateFieldList.Customer;
        let getReservationTableFieldKeyValue = updateFieldList.Reservation;
        let getCustomerFieldTableKeyValue = updateFieldList.CustomerField;

        let token1FieldColumnName = '';
        let token2FieldColumnName = '';
        let token3FieldColumnName = '';
        let getEventSql = `SELECT F1.fieldColumnName AS f1Name, F2.fieldColumnName AS f2Name, F3.fieldColumnName AS f3Name FROM Event 
        LEFT OUTER JOIN Field AS F1 ON Event.token1FieldId = F1.fieldId
        LEFT OUTER JOIN Field AS F2 ON Event.token2FieldId = F2.fieldId
        LEFT OUTER JOIN Field AS F3 ON Event.token3FieldId = F3.fieldId
        WHERE eventId = ?`;
        let [query_result_events] = await mysql_con.execute(getEventSql, [eventId]);
        console.log('query_result_events', query_result_events[0]);
        if (query_result_events && query_result_events.length > 0) {
            token1FieldColumnName = query_result_events[0].f1Name;
            token2FieldColumnName = query_result_events[0].f2Name;
            token3FieldColumnName = query_result_events[0].f3Name;
        }

        console.log('getCustomerTableFieldKeyValue', getCustomerTableFieldKeyValue);

         /*get previousResult*/
         let beforeSqlReservation = `SELECT * FROM Reservation 
         LEFT JOIN Customer ON Reservation.customerId = Customer.customerId
         WHERE Reservation.customerId = ? AND reservationId = ?`;
         let beforeSqlCustomer = `SELECT * FROM Customer WHERE customerId = ?`;
         let [beforeResultReservation] = await mysql_con.execute(beforeSqlReservation, [Number(customerId),Number(reservationId)]);
        let reservationNoValue = beforeResultReservation[0]?.reservationNo ?? ''; 
        /*get previousResult*/


        if (getCustomerTableFieldKeyValue.length > 0) {
            /*get previousResult*/
            
            let [beforeResultCustomer] = await mysql_con.execute(beforeSqlCustomer, [Number(customerId)]);
            /*get previousResult*/
            let keyValuesData = await prepareKeyValue(getCustomerTableFieldKeyValue,beforeResultCustomer[0],'Customer.',logData);
            let getCustomerDynamicToken = updateCustomerToken(getCustomerTableFieldKeyValue,beforeResultCustomer[0],'Customer.',logData,token1FieldColumnName,
            token2FieldColumnName,
            token3FieldColumnName);
            console.log('----------keyValuesData111---------------', keyValuesData);
            console.log('getCustomerDynamicToken',getCustomerDynamicToken);

            let updateCustomerParam = keyValuesData.objectValues;
            let updateCustomerParam2 = getCustomerDynamicToken.objectValues;
            updateCustomerParam.push(createdAt);
            updateCustomerParam.push(updatedBy);
            updateCustomerParam.push(Number(customerId));
            updateCustomerParam2.push(updatedBy);
            updateCustomerParam2.push(Number(customerId));
            let updateSqlCustomer = `UPDATE Customer SET ${keyValuesData.objectKeys} updatedAt = ?,updatedBy = ? where customerId = ?`;
            let updateSqlCustomer2 = `UPDATE Customer SET ${getCustomerDynamicToken.objectKeys} updatedBy = ? where customerId = ?`;
            console.log('updateSql', updateSqlCustomer);
            console.log('updateParam', updateCustomerParam);

            let [query_result_customer] = await mysql_con.execute(updateSqlCustomer, updateCustomerParam);
            let [query_result_customer2] = await mysql_con.execute(updateSqlCustomer2, updateCustomerParam2);
            console.log('query_result_customer AffectedRows', query_result_customer.affectedRows);
            console.log('query_result_customer AffectedRows', query_result_customer2?.affectedRows);
        }
        //FIXME: Reservation data may not be created
        if (getReservationTableFieldKeyValue.length > 0 && reservationId !== null) {
           
            let keyValuesData = await prepareKeyValue(getReservationTableFieldKeyValue,beforeResultReservation[0],'Reservation.',logData);
            
            console.log('----------keyValuesData222---------------', keyValuesData);
            let updateParam = keyValuesData.objectValues;

            let getCustomerDynamicToken = updateCustomerToken(getReservationTableFieldKeyValue,beforeResultReservation[0],'Reservation.',logData,token1FieldColumnName,
            token2FieldColumnName,
            token3FieldColumnName);
            console.log('getCustomerDynamicToken',getCustomerDynamicToken);
            let updateCustomerParam2 = getCustomerDynamicToken.objectValues;
            updateCustomerParam2.push(updatedBy);
            updateCustomerParam2.push(Number(customerId));
            let updateSqlCustomer2 = `UPDATE Customer SET ${getCustomerDynamicToken.objectKeys} updatedBy = ? where customerId = ?`;
            let [query_result_customer2] = await mysql_con.execute(updateSqlCustomer2, updateCustomerParam2);
            console.log('query_result_customer AffectedRows', query_result_customer2?.affectedRows);

            updateParam.push(createdAt);
            updateParam.push(updatedBy);
            updateParam.push(Number(reservationId));
            updateParam.push(Number(customerId));
            let updateSql = `UPDATE Reservation SET ${keyValuesData.objectKeys} updatedAt = ?,updatedBy = ? where reservationId = ? AND customerId = ?`;
            console.log('updateSql', updateSql);
            console.log('updateParam', updateParam);
            if (Number(reservationId) > 0) {
                let [query_result] = await mysql_con.execute(updateSql, updateParam);
                console.log('queryresult AffectedRows', query_result.affectedRows);
            }

        }
       
        if (getCustomerFieldTableKeyValue.length > 0) {
            getCustomerFieldTableKeyValue.map(async (item) => {
                let getSql = `SELECT fieldId,reservationNo,customerFieldText,customerFieldList,customerFieldBoolean,customerFieldInt,memo FROM CustomerField WHERE fieldId = ? AND customerId = ?`;
                let [query_result_customerField_exits] = await mysql_con.execute(getSql, [item.fieldId, parseInt(customerId)]);
                console.log('query_result_customerField_exits', query_result_customerField_exits);
                let updateCustomerFieldSql = '';
                if (query_result_customerField_exits && query_result_customerField_exits[0]?.fieldId > 0) {
                    if(item?.fieldType==4 && item.fieldValue==''){
                        //deleteBool
                        updateCustomerFieldSql = `DELETE FROM CustomerField where fieldId = ? AND customerId = ?`;
                        let [query_result_customerField] = await mysql_con.execute(updateCustomerFieldSql, [item.fieldId, parseInt(customerId)]);
                        console.log('query_result_customerField111 AffectedRows', query_result_customerField.affectedRows);
                    }else{
                        updateCustomerFieldSql = `UPDATE CustomerField SET ${item.fieldKey} = ?, updatedAt = ? , updatedBy = ?, reservationNo = ? WHERE fieldId = ? AND customerId = ?`;
                        let [query_result_customerField] = await mysql_con.execute(updateCustomerFieldSql, [item.fieldValue, createdAt, changer, reservationNoValue, item.fieldId, parseInt(customerId)]);
                        console.log('query_result_customerField111 AffectedRows', query_result_customerField.affectedRows);
                    }
                    // console.log('updateValues', item);
                    logData.push({
                        //fieldName: `CustomerField.${item.fieldKey}`,
                        fieldName: item.fieldName,
                        beforeValue:query_result_customerField_exits[0][item.fieldKey]??'',
                        afterValue:item.fieldValue
                    })
                } else {
                    updateCustomerFieldSql = `INSERT INTO CustomerField(${item.fieldKey}, fieldId, customerId, projectId, createdAt, createdBy, updatedAt, updatedBy,reservationNo) VALUES(?, ?, ?, 0, ?, ?, ?, ?, ?)`;
                    // console.log('updateValues', item);
                    logData.push({
                        //fieldName: `CustomerField.${item.fieldKey}`,
                        fieldName: item.fieldName,
                        beforeValue:'',
                        afterValue:item.fieldValue
                    })
                    let [query_result_customerField] = await mysql_con.execute(updateCustomerFieldSql, [item.fieldValue, item.fieldId, parseInt(customerId), createdAt, changer, createdAt, changer,reservationNoValue]);
                    console.log('query_result_customerField222 AffectedRows', query_result_customerField.affectedRows);
                }
            });
            console.log('logDatas',logData);
        }
        //updateTokenField
        let [afterResultReservation] = await mysql_con.execute(beforeSqlReservation, [Number(customerId),Number(reservationId)]);
        let [afterResultCustomer] = await mysql_con.execute(beforeSqlCustomer, [Number(customerId)]);
        let updatedTokenKey = '';
        let updatedTokenParam = [];
        [token1FieldColumnName, token2FieldColumnName, token3FieldColumnName].map((item, index) => {
            if (item) {
                let tokenDb = item.split(".")[0];
                let tokenKey = item.split(".")[1];
                updatedTokenKey += `token${index + 1} = ?,`;
                let updateTokenvalue = '';
                if (formData.hasOwnProperty(tokenKey) || formData.hasOwnProperty('birthdayDatetime')) {
                    if (tokenKey == 'birthday') {
                        console.log('its birthday');
                        if (afterResultCustomer && afterResultCustomer[0]) {
                            let date = new Date(afterResultCustomer[0].birthdayDatetime * 1000);
                            console.log('CustomerbirthdayTimesssss',date);
                            updateTokenvalue = date.getFullYear() + ("0" + (date.getMonth() + 1)).slice(-2) + ("0" + (date.getDate())).slice(-2);
                            console.log('updateTokenvalue',updateTokenvalue);
                        }
                    } else {
                        console.log('its NON birthday',tokenDb);
                        if (tokenDb == 'Customer') {
                            if (afterResultCustomer && afterResultCustomer[0]) {
                                let customerObjs = afterResultCustomer[0];
                                updateTokenvalue = customerObjs[tokenKey] ?? '';
                            }
                        } else if (tokenDb == 'Reservation') {
                            if (afterResultReservation && afterResultReservation[0]) {
                                let reservationObjs = afterResultReservation[0];
                                updateTokenvalue = reservationObjs[tokenKey] ?? '';
                            }
                        }
                    }

                }
                updatedTokenParam.push(updateTokenvalue);
            }
        });
        updatedTokenParam.push(updatedBy);
        updatedTokenParam.push(Number(customerId));
        console.log('updatedTokenKey',updatedTokenKey);
        console.log('updatedTokenParam',updatedTokenParam);
        if (updatedTokenKey != '') {
            let updateSqlCustomer211 = `UPDATE Customer SET ${updatedTokenKey} updatedBy = ? where customerId = ?`; 
            await mysql_con.execute(updateSqlCustomer211, updatedTokenParam);
        }
       
        await mysql_con.commit();
        // success log
        logData = modyFiedLogData(logData);
        await createLog(context, '顧客編集', '更新', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "*",
            },
            body: JSON.stringify(updateFieldList),
        };
    } catch (error) {
        mysql_con.rollback();
        console.log(error);
        // failure log
        logData = modyFiedLogData(logData);
        await createLog(context, '顧客編集', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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

async function prepareKeyValue(FieldKeyValueArray,beforeResults,tableName='Customer.',logData) {
    let customerUpdatedValueParam = [];
    let customerKeyBind = '';
    FieldKeyValueArray.map(item => {
        customerKeyBind += ` ${item.fieldKey} = ?, `;
        let itemValue = item?.fieldType == 4 && item.fieldValue==''?null:item.fieldValue;
        // fieldStyleのあるリスト型の場合、構造を組み直す
        if (item?.fieldType == 3 && item?.fieldStyle != null) {
            // console.log("item", item);
            let listValues = [];
            for(let i = 0; i < item.fieldValue.length; i++) {
                for (let j = 0; j < item.fieldStyle.lookup.length; j++) {
                    if (item.fieldValue[i].id !== undefined) {
                        if (item.fieldValue[i].id == item.fieldStyle.lookup[j].fieldListCode) {
                            listValues.push(
                                {
                                    'id': item.fieldStyle.lookup[j].fieldListCode,
                                    'checked': true
                                }
                            );
                        }
                    }
                    else {
                        if (item.fieldValue[i] == item.fieldStyle.lookup[j].fieldListCode) {
                            listValues.push(
                                {
                                    'id': item.fieldStyle.lookup[j].fieldListCode,
                                    'checked': true
                                }
                            );
                        }
                    }
                }
            }
            const uniqueListValues = Array.from(
                new Map(listValues.map((row) => [row.id, row])).values()
            );
            console.log("listItemValue", uniqueListValues);
            itemValue = uniqueListValues;
        }
        customerUpdatedValueParam.push(itemValue);
        logData.push({
            //fieldName: `${tableName}${item.fieldKey}`,
            fieldName: item.fieldName,
            beforeValue:beforeResults[item.fieldKey]??'',
            afterValue:itemValue
        })
    });
    // customerKeyBind = customerKeyBind.replace(/,(\s+)?$/, '');
    return { objectKeys: customerKeyBind, objectValues: customerUpdatedValueParam };
}
function updateCustomerToken(FieldKeyValueArray,beforeResults,tableName='Customer.',logData,token1FieldColumnName,
token2FieldColumnName,
token3FieldColumnName) {
    console.log('token1FieldColumnName',token1FieldColumnName)
    console.log('token2FieldColumnName',token2FieldColumnName)
    console.log('token3FieldColumnName',token3FieldColumnName)
    let customerUpdatedValueParam = [];
    let customerKeyBind = '';

    let isBirthdayExists = FieldKeyValueArray.find((row) => row.fieldKey == "birthday");
    isBirthdayExists = isBirthdayExists??'';
    let isToken1Exists = FieldKeyValueArray.find((row) => row.fieldKey == "token1");
    isToken1Exists = isToken1Exists??'';
    let isToken2Exists = FieldKeyValueArray.find((row) => row.fieldKey == "token2");
    isToken2Exists = isToken2Exists??'';
    let isToken3Exists = FieldKeyValueArray.find((row) => row.fieldKey == "token3");
    isToken3Exists = isToken3Exists ?? '';
    console.log('isToken1Exists',isToken1Exists)
    console.log('isToken2Exists',isToken2Exists)
    console.log('isToken3Exists',isToken3Exists)
    FieldKeyValueArray.map(item => {
        if (item.fieldKey == 'birthdayDatetime') {
            let date = new Date(item.fieldValue * 1000)
            let fieldValue = date.getFullYear() + ("0" + (date.getMonth()+1)).slice(-2) + ("0" + (date.getDate())).slice(-2)
            if(item.fieldId!=0 && item.fieldKey!='' && !isBirthdayExists){
                customerKeyBind += ` birthday = ?, `;
                customerUpdatedValueParam.push(fieldValue);
                logData.push({
                    fieldName: "生年月日",
                    beforeValue:beforeResults?.birthday??'',
                    afterValue:fieldValue
                });
                
            }

            if (token1FieldColumnName != '' && token1FieldColumnName == "Customer.birthday" && !isToken1Exists && !customerKeyBind.includes("token1,")) {
                customerKeyBind += ` token1 = ?, `;
                customerUpdatedValueParam.push(fieldValue);
                logData.push({
                    fieldName: "トークン1",
                    beforeValue:beforeResults?.token1??'',
                    afterValue:fieldValue
                });
            }
            if (token2FieldColumnName != '' && token2FieldColumnName == "Customer.birthday" && !isToken2Exists && !customerKeyBind.includes("token2,")) {
                customerKeyBind += `token2 = ?, `;
                customerUpdatedValueParam.push(fieldValue);
                logData.push({
                    fieldName: "トークン2",
                    beforeValue:beforeResults?.token2??'',
                    afterValue:fieldValue
                });
            }
            if (token3FieldColumnName != '' && token3FieldColumnName == "Customer.birthday" && !isToken3Exists && !customerKeyBind.includes("token3,")) {
                customerKeyBind += `token3 = ?, `;
                customerUpdatedValueParam.push(fieldValue);
                logData.push({
                    fieldName: "トークン3",
                    beforeValue:beforeResults?.token3??'',
                    afterValue:fieldValue
                });
            }


        } else {
    console.log('fkey',`${tableName}${item?.fieldKey}`)
    console.log('Gkey',token1FieldColumnName)
    console.log('customerKeyBind',customerKeyBind)
            
            if (token1FieldColumnName != '' && token1FieldColumnName == `${tableName}${item?.fieldKey}` && !isToken1Exists && !customerKeyBind.includes("token1,")) {
                customerKeyBind += ` token1 = ?, `;
                customerUpdatedValueParam.push(item.fieldValue);
                logData.push({
                    fieldName: "トークン1",
                    beforeValue:beforeResults?.token1??'',
                    afterValue:item?.fieldValue
                });
            }
            if (token2FieldColumnName != '' && token2FieldColumnName == `${tableName}${item?.fieldKey}` && !isToken2Exists && !customerKeyBind.includes("token2,")) {
                customerKeyBind += `token2 = ?, `;
                customerUpdatedValueParam.push(item.fieldValue);
                logData.push({
                    fieldName: "トークン2",
                    beforeValue:beforeResults?.token2??'',
                    afterValue:item?.fieldValue
                });
            }
            if (token3FieldColumnName != '' && token3FieldColumnName == `${tableName}${item?.fieldKey}` && !isToken3Exists && !customerKeyBind.includes("token3,")) {
                customerKeyBind += `token3 = ?, `;
                customerUpdatedValueParam.push(item.fieldValue);
                logData.push({
                    fieldName: "トークン3",
                    beforeValue:beforeResults?.token3??'',
                    afterValue:item?.fieldValue
                });
            }
        }
    });

    return { objectKeys: customerKeyBind, objectValues: customerUpdatedValueParam };

}

function modyFiedLogData(logData){
    if(logData && logData.length>0){
        logData = logData.filter(element => {
            if (Object.keys(element).length !== 0) {
              return true;
            }
            return false;
          });
        console.log('logDataFinal', logData);
        return logData;
    }else{
        return [];
    }
}

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

