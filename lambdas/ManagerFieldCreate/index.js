/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerFieldCreate.
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

    const {
        projectId,
        fieldName,
        fieldManageName,
        fieldOverview,
        fieldDescription,
        fieldType,
        fieldStyle,
        filterId,
        memo,
        createdBy,
        updatedBy
    } = JSON.parse(event.body);
    logAccountId = createdBy;
    let mysql_con;
    try {

        let validProjectId;
        if (event?.requestContext?.authorizer?.pid) {
            validProjectId = JSON.parse(event?.requestContext?.authorizer?.pid);
            // pidがない場合 もしくは 許可プロジェクトIDに含まれていない場合
            if (!event.queryStringParameters?.pid || validProjectId.indexOf(Number(event.queryStringParameters?.pid)) == -1) {
                // failure log
                await createLog(context, 'フィールド', '作成', '失敗', '403', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
                return {
                    statusCode: 403,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': '*',
                    },
                    body: JSON.stringify("Unauthorized"),
                };
            }
        }

        // ログ書き込み
        logData[0] = {};
        logData[0].fieldName = "プロジェクトID";
        logData[0].beforeValue = "";
        logData[0].afterValue = projectId;
        logData[1] = {};
        logData[1].fieldName = "フィールド名";
        logData[1].beforeValue = "";
        logData[1].afterValue = fieldName;
        logData[2] = {};
        logData[2].fieldName = "フィールド管理名";
        logData[2].beforeValue = "";
        logData[2].afterValue = fieldManageName;
        logData[3] = {};
        logData[3].fieldName = "フィールド説明";
        logData[3].beforeValue = "";
        logData[3].afterValue = fieldOverview;
        logData[4] = {};
        logData[4].fieldName = "フィールド説明";
        logData[4].beforeValue = "";
        logData[4].afterValue = fieldDescription;
        logData[5] = {};
        logData[5].fieldName = "フィールドタイプ";
        logData[5].beforeValue = "";
        logData[5].afterValue = fieldType;
        logData[6] = {};
        logData[6].fieldName = "フィールドスタイルJSON";
        logData[6].beforeValue = "";
        logData[6].afterValue = fieldStyle;
        logData[7] = {};
        logData[7].fieldName = "このフィールドを表示する条件";
        logData[7].beforeValue = "";
        logData[7].afterValue = filterId;
        logData[8] = {};
        logData[8].fieldName = "メモ";
        logData[8].beforeValue = "";
        logData[8].afterValue = memo;

        // regist view code
        let params = {
            FunctionName: "getviewcode-" + process.env.ENV,
            InvocationType: "RequestResponse"
        };
        let codeData = await lambda.invoke(params).promise();
        console.log(codeData);
        let fieldCode = JSON.parse(codeData.Payload);
        // fieldStyleの作成
        let fieldStyleJson = {};
        switch (Number(fieldType)) {
            // テキスト型
            case 0:
                fieldStyleJson = {
                    caption: fieldName,
                    dataField: fieldCode,
                    name: fieldCode,
                    dataType: "string"
                };
                // const fieldsql = "SELECT * FROM EventField WHERE eventId = ? AND eventFieldTable = 'CustomerFieldText'"
                // const [field_result] = await mysql_con.execute(sql_data, []);
                break;
            // テキストエリア型
            case 1:
                fieldStyleJson = {
                    caption: fieldName,
                    dataField: fieldCode,
                    name: fieldCode,
                    dataType: "string"
                };
                break;
            // 結合テキスト型
            case 2:
                fieldStyleJson = {
                    caption: fieldName,
                    dataField: fieldCode,
                    name: fieldCode,
                    dataType: "string",
                    fieldCount: fieldStyle
                };
                break;
            // リスト型
            case 3:
                // regist view code
                let params = {
                    FunctionName: "getviewcode-" + process.env.ENV,
                    InvocationType: "RequestResponse"
                };
                console.log(fieldStyle);
                for (let i = 0; i < fieldStyle.length; i++) {
                    let codeData = await lambda.invoke(params).promise();
                    let fieldListCode = JSON.parse(codeData.Payload);
                    fieldStyle[i].fieldListCode = fieldListCode;
                }
                fieldStyleJson = {
                    caption: fieldName,
                    dataField: fieldCode,
                    name: fieldCode,
                    lookup: fieldStyle
                };
                console.log(fieldStyleJson);
                break;
            // YesNo型
            case 4:
                fieldStyleJson = {
                    caption: fieldName,
                    dataField: fieldCode,
                    name: fieldCode,
                    dataType: "boolean",
                    trueText: fieldStyle.trueText,
                    falseText: fieldStyle.falseText
                };
                break;
            // 日付型
            case 5:
                fieldStyleJson = {
                    caption: fieldName,
                    dataField: "" + fieldCode,
                    name: fieldCode,
                    dataType: "number"
                };
                break;
            // 時間型
            case 6:
                fieldStyleJson = {
                    caption: fieldName,
                    dataField: fieldCode,
                    name: fieldCode,
                    dataType: "number"
                };
                break;
            // 数値型
            case 7:
                fieldStyleJson = {
                    caption: fieldName,
                    dataField: fieldCode,
                    name: fieldCode,
                    dataType: "number"
                };
                break;
        }

        // mysql connect
        mysql_con = await mysql.createConnection(writeDbConfig);
        await mysql_con.beginTransaction();

        /*
        // field nameのユニークチェック
        // get count query
        let count_sql = `SELECT COUNT(fieldId) FROM Field WHERE fieldName = ?;`;
        // get count
        let [query_count_result] = await mysql_con.execute(count_sql, [fieldName]);
    
        let data_count = Object.values(query_count_result[0]);
        console.log("project_count", data_count);
        // Check if the project already exists
        if (data_count > 0) {
            // Already exists, send error response
            console.log("Already exists");
            return {
                statusCode: 409,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "*",
                },
                body: JSON.stringify({ message: "Duplicate entry" }),
            };
        }
        */

        // insert data query
        let sql_data = `INSERT INTO Field (
            projectId,
            fieldCode,
            fieldName,
            fieldManageName,
            fieldOverview,
            fieldDescription,
            fieldType,
            fieldStyle,
            filterId,
            memo,
            createdAt,
            createdBy,
            updatedAt,
            updatedBy
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`;
        // created date
        const createdAt = Math.floor(new Date().getTime() / 1000);
        let sql_param = [
            projectId,
            fieldCode,
            fieldName,
            fieldManageName,
            fieldOverview,
            fieldDescription,
            fieldType,
            fieldStyleJson,
            filterId,
            memo,
            createdAt,
            createdBy,
            createdAt,
            updatedBy,
        ];
        console.log("sql_data:", sql_data);
        console.log("sql_param:", sql_param);
        const [query_result] = await mysql_con.execute(sql_data, sql_param);
        if (query_result.length === 0) {
            // failure log
            await createLog(context, 'フィールド', '作成', '失敗', '404', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
            return {
                statusCode: 404,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "*",
                },
                body: JSON.stringify({
                    message: "no data"
                }),
            };
        }
        await mysql_con.commit();

        // construct the response
        let response = {
            records: query_result[0]
        };
        // console.log("response:", response);
        // success log
        await createLog(context, 'フィールド', '作成', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "*",
            },
            body: JSON.stringify(response),
        };
    } catch (error) {
        await mysql_con.rollback();
        console.log("error:", error);
        // failure log
        await createLog(context, 'フィールド', '作成', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
