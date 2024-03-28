/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerCategoryCreate.
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
        categoryStatus,
        categoryName,
        categoryManageName,
        categoryOverview,
        categoryDescription,
        categoryDescription2,
        categoryImageURL1,
        categoryImageURL2,
        categoryImageURL3,
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
                await createLog(context, '予約カテゴリー', '作成', '失敗', '403', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
        logData[1].fieldName = "予約カテゴリー名";
        logData[1].beforeValue = "";
        logData[1].afterValue = categoryName;
        logData[2] = {};
        logData[2].fieldName = "予約カテゴリー管理名";
        logData[2].beforeValue = "";
        logData[2].afterValue = categoryManageName;
        logData[3] = {};
        logData[3].fieldName = "予約カテゴリー説明";
        logData[3].beforeValue = "";
        logData[3].afterValue = categoryOverview;
        logData[4] = {};
        logData[4].fieldName = "予約カテゴリー説明";
        logData[4].beforeValue = "";
        logData[4].afterValue = categoryDescription;
        logData[5] = {};
        logData[5].fieldName = "予約カテゴリー説明2";
        logData[5].beforeValue = "";
        logData[5].afterValue = categoryDescription2;
        logData[6] = {};
        logData[6].fieldName = "カテゴリーメンテナンス";
        logData[6].beforeValue = "";
        logData[6].afterValue = categoryStatus;
        logData[7] = {};
        logData[7].fieldName = "予約カテゴリー画像1";
        logData[7].beforeValue = "";
        logData[7].afterValue = categoryImageURL1;
        logData[8] = {};
        logData[8].fieldName = "予約カテゴリー画像2";
        logData[8].beforeValue = "";
        logData[8].afterValue = categoryImageURL2;
        logData[9] = {};
        logData[9].fieldName = "予約カテゴリー画像3";
        logData[9].beforeValue = "";
        logData[9].afterValue = categoryImageURL3;
        logData[10] = {};
        logData[10].fieldName = "メモ";
        logData[10].beforeValue = "";
        logData[10].afterValue = memo;

        // mysql connect
        mysql_con = await mysql.createConnection(writeDbConfig);
        await mysql_con.beginTransaction();
        // insert data query
        let sql_data = `INSERT INTO Category (
            projectId,
            categoryStatus,
            categoryName,
            categoryManageName,
            categoryOverview,
            categoryDescription,
            categoryDescription2,
            categoryImageURL1,
            categoryImageURL2,
            categoryImageURL3,
            memo,
            createdAt,
            createdBy,
            updatedAt,
            updatedBy
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`;
        // created date
        const createdAt = Math.floor(new Date().getTime() / 1000);
        let sql_param = [
            projectId,
            categoryStatus,
            categoryName,
            categoryManageName,
            categoryOverview,
            categoryDescription,
            categoryDescription2,
            categoryImageURL1,
            categoryImageURL2,
            categoryImageURL3,
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
            await mysql_con.rollback();
            // failure log
            await createLog(context, '予約カテゴリー', '作成', '失敗', '404', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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

        // フィールドも作成する
        // regist view code
        let categoryId = query_result.insertId;
        let params = {
            FunctionName: "getviewcode-" + process.env.ENV,
            InvocationType: "RequestResponse"
        };
        let codeData = await lambda.invoke(params).promise();
        console.log(codeData);
        let fieldCode = JSON.parse(codeData.Payload);
        let sql_field = `INSERT INTO Field(projectId, fieldName, fieldCode, fieldType, fieldColumnName, fieldColumnSubId, createdAt, createdBy, updatedAt, updatedBy) 
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const [query_result2] = await mysql_con.query(sql_field, [
            projectId,
            '[予約カテゴリー] ' + categoryName,
            fieldCode,
            10,
            'Category.categoryId',
            categoryId,
            createdAt,
            createdBy,
            createdAt,
            updatedBy,
        ]);
        if (query_result2.length === 0) {
            await mysql_con.rollback();
            // failure log
            await createLog(context, '予約カテゴリー', '作成', '失敗', '404', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
        await createLog(context, '予約カテゴリー', '作成', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
        await createLog(context, '予約カテゴリー', '作成', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
