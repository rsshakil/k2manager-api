/**
* @type {import('@types/aws-lambda').APIGatewayProxyHandler}
*/
const AWS = require('aws-sdk')
const mysql = require('mysql2/promise')
const ssm = new AWS.SSM()
const uuid = require('uuid');
const lambda = new AWS.Lambda();
const crypto = require('crypto')
process.env.TZ = "Asia/Tokyo";

exports.handler = async (event,context) => {
    let logData = [];
    let logAccountId;
    // Reading encrypted environment variables --- required
    if (process.env.DBINFO == null) {
        const ssmreq = {
            Name: 'DBINFO_' + process.env.ENV,
            WithDecryption: true,
        }
        const ssmparam = await ssm.getParameter(ssmreq).promise()
        const dbinfo = JSON.parse(ssmparam.Parameter.Value)
        process.env.DBWRITEENDPOINT = dbinfo.DBWRITEENDPOINT
        process.env.DBREADENDPOINT = dbinfo.DBREADENDPOINT
        process.env.DBUSER = dbinfo.DBUSER
        process.env.DBPASSWORD = dbinfo.DBPASSWORD
        process.env.DBDATABSE = dbinfo.DBDATABSE
        process.env.DBPORT = dbinfo.DBPORT
        process.env.DBCHARSET = dbinfo.DBCHARSET
        process.env.DBINFO = true
    }

    // Database info
    const writeDbConfig = {
        host: process.env.DBWRITEENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET,
    }
    // console.log(event.body);
    const {
        insuranceSymbol,
        insuranceNo,
        birthday,
        memo,
        updateFieldList,
        projectId,
        createdBy,
        updatedBy
    } = JSON.parse(event.body)
    logAccountId = createdBy;
    try {
        const mysql_con = await mysql.createConnection(writeDbConfig)
        const createdAt = Math.floor(new Date().getTime() / 1000);
        async function prepareKeyValue(FieldKeyValueArray) {
            let customerUpdatedValueParam = [];
            let customerFields = [
                'customerFieldText',
                'customerFieldList',
                'customerFieldBoolean',
                'customerFieldInt'
            ];
            let customerKeyBind = '';
            let customerValueBind = '';
            let eventRowInfo = FieldKeyValueArray.find((row) => row.fieldKey == "eventId");
            let isBirthdayExists = FieldKeyValueArray.find((row) => row.fieldKey == "birthday");
            isBirthdayExists = isBirthdayExists??'';
            let isToken1Exists = FieldKeyValueArray.find((row) => row.fieldKey == "token1");
            isToken1Exists = isToken1Exists??'';
            let isToken2Exists = FieldKeyValueArray.find((row) => row.fieldKey == "token2");
            isToken2Exists = isToken2Exists??'';
            let isToken3Exists = FieldKeyValueArray.find((row) => row.fieldKey == "token3");
            isToken3Exists = isToken3Exists??'';
            let token1FieldColumnName = '';
            let token2FieldColumnName = '';
            let token3FieldColumnName = '';
            if (eventRowInfo?.fieldValue > 0) {
                let getEventSql = `SELECT F1.fieldColumnName AS f1Name, F2.fieldColumnName AS f2Name, F3.fieldColumnName AS f3Name FROM Event 
                LEFT OUTER JOIN Field AS F1 ON Event.token1FieldId = F1.fieldId
                LEFT OUTER JOIN Field AS F2 ON Event.token2FieldId = F2.fieldId
                LEFT OUTER JOIN Field AS F3 ON Event.token3FieldId = F3.fieldId
                WHERE eventId = ?`;
                let [query_result_events] = await mysql_con.execute(getEventSql, [eventRowInfo.fieldValue]);
                console.log('query_result_customerField_exits', query_result_events[0]);
                if (query_result_events && query_result_events.length > 0) {
                    token1FieldColumnName = query_result_events[0].f1Name;
                    token2FieldColumnName = query_result_events[0].f2Name;
                    token3FieldColumnName = query_result_events[0].f3Name;
                }
            }
            let i = 6;
            logData[0] = {};
            logData[0].fieldName = "プロジェクトID";
            logData[0].beforeValue = "";
            logData[0].afterValue = projectId;
            FieldKeyValueArray.map(item => {
                // console.log('bbbbbbbbbb', item.fieldKey);
                // console.log('eventRowInfo', eventRowInfo);
                if(item.fieldId!=0 && item.fieldKey!='' && !customerFields.includes(item.fieldKey)){
                    customerKeyBind += ` ${item.fieldKey}, `;
                    customerValueBind += ` ?, `;
                    customerUpdatedValueParam.push(item.fieldValue);
                    logData[i] = {};
                    logData[i].fieldName = item.fieldKey;
                    logData[i].beforeValue = "";
                    logData[i].afterValue = item.fieldValue;
                }
                
                if (item.fieldKey == 'birthdayDatetime') {
                    let date = new Date(item.fieldValue * 1000)
                    let fieldValue = date.getFullYear() + ("0" + (date.getMonth()+1)).slice(-2) + ("0" + (date.getDate())).slice(-2)
                    if(item.fieldId!=0 && item.fieldKey!='' && !isBirthdayExists){
                        customerKeyBind += ` birthday, `;
                        customerValueBind += ` ?, `;
                        customerUpdatedValueParam.push(fieldValue);
                        logData[1] = {};
                        logData[1].fieldName = "birthday";
                        logData[1].beforeValue = "";
                        logData[1].afterValue = fieldValue;
                    }
                    if (token1FieldColumnName != '' && token1FieldColumnName == "Customer.birthday" && !isToken1Exists && !customerKeyBind.includes("token1,")) {
                        customerKeyBind += `token1, `;
                        customerValueBind += ` ?, `;
                        customerUpdatedValueParam.push(fieldValue);
                        logData[2] = {};
                        logData[2].fieldName = "token1";
                        logData[2].beforeValue = "";
                        logData[2].afterValue = fieldValue;
                    }
                    if (token2FieldColumnName != '' && token2FieldColumnName == "Customer.birthday" && !isToken2Exists && !customerKeyBind.includes("token2,")) {
                        customerKeyBind += `token2, `;
                        customerValueBind += ` ?, `;
                        customerUpdatedValueParam.push(fieldValue);
                        logData[3] = {};
                        logData[3].fieldName = "token2";
                        logData[3].beforeValue = "";
                        logData[3].afterValue = fieldValue;
                    }
                    if (token3FieldColumnName != '' && token3FieldColumnName == "Customer.birthday" && !isToken3Exists && !customerKeyBind.includes("token3,")) {
                        customerKeyBind += `token3, `;
                        customerValueBind += ` ?, `;
                        customerUpdatedValueParam.push(fieldValue);
                        logData[4] = {};
                        logData[4].fieldName = "token3";
                        logData[4].beforeValue = "";
                        logData[4].afterValue = fieldValue;
                    }
                }else{
                    if (token1FieldColumnName && token1FieldColumnName == "Customer." + item.fieldKey && !isToken1Exists && !customerKeyBind.includes("token1,")) {
                        customerKeyBind += `token1, `;
                        customerValueBind += ` ?, `;
                        customerUpdatedValueParam.push(item.fieldValue);
                        logData[2] = {};
                        logData[2].fieldName = "token1";
                        logData[2].beforeValue = "";
                        logData[2].afterValue = fieldValue;
                    }
                    if (token2FieldColumnName && token2FieldColumnName == "Customer." + item.fieldKey && !isToken2Exists && !customerKeyBind.includes("token2,")) {
                        customerKeyBind += `token2, `;
                        customerValueBind += ` ?, `;
                        customerUpdatedValueParam.push(item.fieldValue);
                        logData[3] = {};
                        logData[3].fieldName = "token2";
                        logData[3].beforeValue = "";
                        logData[3].afterValue = fieldValue;
                    }
                    if (token3FieldColumnName && token3FieldColumnName == "Customer." + item.fieldKey && !isToken3Exists && !customerKeyBind.includes("token3,")) {
                        customerKeyBind += `token3, `;
                        customerValueBind += ` ?, `;
                        customerUpdatedValueParam.push(item.fieldValue);
                        logData[4] = {};
                        logData[4].fieldName = "token3";
                        logData[4].beforeValue = "";
                        logData[4].afterValue = fieldValue;
                    }
                }
                i++;
            });
            customerKeyBind += ' customerUUID, customerSystemId, createdAt, createdBy, updatedAt, updatedBy';
            customerValueBind += ' ?, ?, ?, ?, ?, ? ';
            customerUpdatedValueParam.push(uuid.v4());
            customerUpdatedValueParam.push(getRandomData(8));
            customerUpdatedValueParam.push(createdAt);
            customerUpdatedValueParam.push(createdBy);
            customerUpdatedValueParam.push(createdAt);
            customerUpdatedValueParam.push(createdBy);
            return { objectKeys: customerKeyBind, objectValues: customerUpdatedValueParam, objectValueBind: customerValueBind };
        }
        //
        // console.log('-----------------------------');
        // console.log(updateFieldList);
        if (updateFieldList.length > 0) {
            let customerFieldList = [
                'customerFieldText',
                'customerFieldList',
                'customerFieldBoolean',
                'customerFieldInt'
            ];
            let findCustomerFieldRows = updateFieldList.filter(item=>customerFieldList.includes(item.fieldKey));
            console.log('findCustomerFieldRows',findCustomerFieldRows);
            let keyValuesData = await prepareKeyValue(updateFieldList);
            console.log('----------keyValuesData111---------------', keyValuesData);
            let updateCustomerParam = keyValuesData.objectValues;
            let updateSqlCustomer = `INSERT into Customer (${keyValuesData.objectKeys}) values (${keyValuesData.objectValueBind})`;
            console.log('updateSql', updateSqlCustomer);
            // console.log('updateParam', updateCustomerParam);

            var [query_result] = await mysql_con.execute(updateSqlCustomer, updateCustomerParam);
            let lastCustomerInsertId = query_result?.insertId;
            let j=200;
            findCustomerFieldRows.length>0 && findCustomerFieldRows.map(async (item)=>{
                if(item.fieldId!=0){
                    let updateCustomerFieldSqls = `INSERT INTO CustomerField SET ${item.fieldKey} = ?, fieldId = ?, customerId = ?`;
                    let [query_result_customerField] = await mysql_con.execute(updateCustomerFieldSqls, [item.fieldValue, item.fieldId, parseInt(lastCustomerInsertId)]);
                    logData[j] = {};
                    logData[j].fieldName = `CustomerTableField ${item.fieldKey}`;
                    logData[j].beforeValue = "";
                    logData[j].afterValue = item.fieldValue;
                    j++;
                }
            });
            // console.log('query_result_customer', query_result);
            console.log('query_result_customer insertId', query_result?.insertId);
            console.log('query_result_customer AffectedRows', query_result.affectedRows);
        }
        if (query_result.length === 0) {
            // failure log
            await createLog(context, '顧客追加', '作成', '失敗', '404', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
            return {
                statusCode: 404,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify({ message: 'no data' }),
            }
        }
        // construct the response
        let response = { records: query_result[0] }
        // console.log('this is response >>>>>>>>>>>>>>', response)
        // success log
        await createLog(context, '顧客追加', '作成', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify(response),
        }
    } catch (error) {
        console.log(error)
        // failure log
        await createLog(context, '顧客追加', '作成', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
        return {
            statusCode: 400,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify(error),
        }
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

function getRandomData(length) {
    // create random hex
    var str="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    // return Array.from(Array(length)).map(()=>S[Math.floor(Math.random()*str.length)]).join('')
    return Array.from(crypto.randomFillSync(new Uint8Array(length))).map((n)=>str[n%str.length]).join('')
}
