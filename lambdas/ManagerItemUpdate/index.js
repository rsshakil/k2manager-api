/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerItemUpdate.
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
        itemManageName,
        itemName,
        itemOverview,
        itemDescription,
        itemImageURL1,
        itemImageURL2,
        itemImageURL3,
        memo,
        updatedBy,
    } = JSON.parse(event.body);
    logAccountId = updatedBy;

    if (event.pathParameters?.itemId) {
        let itemId = event.pathParameters.itemId;
        console.log("itemId:", itemId);
       
        if (!projectId) {
            // failure log
            await createLog(context, 'アイテム', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
            let error = "invalid parameter. Project ID not found.";
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
            validProjectId = JSON.parse(event?.requestContext?.authorizer?.pid);
            // pidがない場合 もしくは 許可プロジェクトIDに含まれていない場合
            if (!projectId || validProjectId.indexOf(Number(projectId)) == -1) {
                // failure log
                await createLog(context, 'アイテム', '更新', '失敗', '403', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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

        let mysql_con;
        try {
            // mysql connect
            mysql_con = await mysql.createConnection(writeDbConfig);
            await mysql_con.beginTransaction();
            // beforeDataの作成
            let beforeSql = `SELECT * FROM Item WHERE itemId = ? AND projectId = ?`;
            let [beforeResult] = await mysql_con.execute(beforeSql, [itemId, projectId]);
            // Found set already deleted
            if (beforeResult.length === 0) {
                await mysql_con.rollback();
                // failure log
                await createLog(context, 'アイテム', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
                console.log("Found set already deleted");
                return {
                    statusCode: 400,
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Headers": "*",
                    },
                    body: JSON.stringify({
                        message: "Found set already deleted",
                        errorCode: 201
                    }),
                };
            }

            // ログ書き込み
            logData[0] = {};
            logData[0].fieldName = "プロジェクトID";
            logData[0].beforeValue = projectId;
            logData[0].afterValue = projectId;
            logData[1] = {};
            logData[1].fieldName = "アイテムID";
            logData[1].beforeValue = beforeResult[0].itemId;
            logData[1].afterValue = itemId;
            logData[2] = {};
            logData[2].fieldName = "アイテム管理名";
            logData[2].beforeValue = beforeResult[0].itemManageName;
            logData[2].afterValue = itemManageName;
            logData[3] = {};
            logData[3].fieldName = "アイテム名";
            logData[3].beforeValue = beforeResult[0].itemName;
            logData[3].afterValue = itemName;
            logData[4] = {};
            logData[4].fieldName = "アイテム説明";
            logData[4].beforeValue = beforeResult[0].itemOverview;
            logData[4].afterValue = itemOverview;
            logData[5] = {};
            logData[5].fieldName = "アイテム説明";
            logData[5].beforeValue = beforeResult[0].itemDescription;
            logData[5].afterValue = itemDescription;
            logData[6] = {};
            logData[6].fieldName = "アイテム画像1";
            logData[6].beforeValue = beforeResult[0].itemImageURL1;
            logData[6].afterValue = itemImageURL1;
            logData[7] = {};
            logData[7].fieldName = "アイテム画像2";
            logData[7].beforeValue = beforeResult[0].itemImageURL2;
            logData[7].afterValue = itemImageURL2;
            logData[8] = {};
            logData[8].fieldName = "アイテム画像3";
            logData[8].beforeValue = beforeResult[0].itemImageURL3;
            logData[8].afterValue = itemImageURL3;
            logData[9] = {};
            logData[9].fieldName = "メモ";
            logData[9].beforeValue = beforeResult[0].memo;
            logData[9].afterValue = memo;

            const updatedAt = Math.floor(new Date().getTime() / 1000);
            let sql_data = `UPDATE Item SET
                itemManageName = ?,
                itemName = ?,
                itemOverview = ?,
                itemDescription = ?,
                itemImageURL1 = ?,
                itemImageURL2 = ?,
                itemImageURL3 = ?,
                memo = ?,
                updatedAt = ?,
                updatedBy = ?
                WHERE itemId = ? AND projectId = ?;`;
            let sql_param = [
                itemManageName,
                itemName,
                itemOverview,
                itemDescription,
                itemImageURL1,
                itemImageURL2,
                itemImageURL3,
                memo,
                updatedAt,
                updatedBy,
                itemId,
                projectId
            ];
            console.log("sql_data:", sql_data);
            console.log("sql_param:", sql_param);

            let [query_result] = await mysql_con.execute(sql_data, sql_param);
            // // Found set already deleted
            // if (query_result.affectedRows == 0) {
            //     // failure log
            //     await createLog(context, 'アイテム', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
            //     await mysql_con.rollback();
            //     console.log("Found set already deleted");
            //     return {
            //         statusCode: 400,
            //         headers: {
            //             "Access-Control-Allow-Origin": "*",
            //             "Access-Control-Allow-Headers": "*",
            //         },
            //         body: JSON.stringify({
            //             message: "Found set already deleted",
            //             errorCode: 201
            //         }),
            //     };
            // }

            // フィールドも更新する
            let sql_field = `UPDATE Field SET fieldName = ?, updatedAt = ?, updatedBy = ? WHERE projectId = ? AND fieldColumnSubId = ? AND fieldColumnName = ?`;
            const [query_result2] = await mysql_con.query(sql_field, [
                '[アイテム] ' + itemName,
                updatedAt,
                updatedBy,
                projectId,
                itemId,
                'Item.itemId'
            ]);
            if (query_result2.length === 0) {
                // failure log
                await createLog(context, 'アイテム', '更新', '失敗', '404', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
            console.log("response:", response);
            console.log("logData:", logData);
            // successLog
            await createLog(context, 'アイテム', '更新', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
            console.log(error);
            // failure log
            await createLog(context, 'アイテム', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
    } else {
        // failure log
        await createLog(context, 'アイテム', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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