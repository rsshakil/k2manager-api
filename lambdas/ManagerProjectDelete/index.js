/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk');
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerProjectDelete.
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
            WithDecryption: true
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
        charset: process.env.DBCHARSET
    };

    if (event.pathParameters?.projectId) {
        let projectId = event.pathParameters.projectId;
        console.log("projectId:", projectId);
        logAccountId = JSON.parse(event.body).deletedBy;
        let validProjectId;
        if (event?.requestContext?.authorizer?.pid) {
            validProjectId = JSON.parse(event?.requestContext?.authorizer?.pid);
            // 許可プロジェクトIDに含まれていない場合
            if (validProjectId.indexOf(Number(projectId)) == -1) {
                // failure log
                await createLog(context, 'プロジェクト', '削除', '失敗', '403', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
            // 削除データの取得
            // beforeDataの作成
            let beforeSql = `SELECT * FROM Project WHERE projectId = ?`;
            let [beforeResult] = await mysql_con.execute(beforeSql, [projectId]);
            // Found set already deleted
            if (beforeResult.length === 0) {
                await mysql_con.rollback();
                console.log("already deleted or project id is failure");
                // failure log
                await createLog(context, 'プロジェクト', '削除', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
                return {
                    statusCode: 400,
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Headers": "*",
                    },
                    body: JSON.stringify({
                        message: "Project is not found or found set already deleted",
                        errorCode: 101
                    }),
                };
            }

            // ログ書き込み
            logData[0] = {};
            logData[0].fieldName = "プロジェクトID";
            logData[0].beforeValue = projectId;
            logData[0].afterValue = "";
            logData[1] = {};
            logData[1].fieldName = "プロジェクトコード";
            logData[1].beforeValue = beforeResult[0].projectCode;
            logData[1].afterValue = "";
            logData[2] = {};
            logData[2].fieldName = "プロジェクト名";
            logData[2].beforeValue = beforeResult[0].projectName;
            logData[2].afterValue = "";
            logData[3] = {};
            logData[3].fieldName = "プロジェクトステータス";
            logData[3].beforeValue = (beforeResult[0].projectStatus == 0) ? "停止中" : "運用中";
            logData[3].afterValue = "";
            logData[4] = {};
            logData[4].fieldName = "メモ";
            logData[4].beforeValue = beforeResult[0].memo;
            logData[4].afterValue = "";

            // プロジェクト削除
            let sql_data = `DELETE from Project WHERE projectId = ?`;
            var [query_result] = await mysql_con.query(sql_data, [event.pathParameters.projectId]);
            if (query_result.affectedRows >= 1) {
                // フィルター削除
                let sql_data5 = `DELETE from Filter WHERE Filter.projectId = ?`;
                var [query_result5, query_fields5] = await mysql_con.query(sql_data5, [event.pathParameters.projectId]);
                // フィールド削除
                let sql_data6 = `DELETE from Field WHERE Field.projectId = ?`;
                var [query_result6, query_fields6] = await mysql_con.query(sql_data6, [event.pathParameters.projectId]);
                // アイテム削除
                let sql_data8 = `DELETE from Item WHERE Item.projectId = ?`;
                var [query_result8, query_fields8] = await mysql_con.query(sql_data8, [event.pathParameters.projectId]);
                // カウンセラー削除
                let sql_data9 = `DELETE from Counselor WHERE Counselor.projectId = ?`;
                var [query_result9, query_fields9] = await mysql_con.query(sql_data9, [event.pathParameters.projectId]);
                // 施設削除
                let sql_data10 = `DELETE from Institute WHERE projectId = ?`;
                var [query_result10, query_fields10] = await mysql_con.query(sql_data10, [event.pathParameters.projectId]);
                // 顧客削除
                let sql_data11 = `DELETE Customer, Reservation FROM Customer 
                LEFT OUTER JOIN Reservation ON Customer.customerId = Reservation.customerId
                LEFT OUTER JOIN Event ON Customer.eventId = Event.eventId
                WHERE Event.projectId = ?`;
                var [query_result11, query_fields11] = await mysql_con.query(sql_data11, [event.pathParameters.projectId]);
                // CSV削除
                let sql_data12 = `DELETE from CSV WHERE CSV.projectId = ?`;
                var [query_result12, query_fields12] = await mysql_con.query(sql_data12, [event.pathParameters.projectId]);
                // バス削除 （バスはもっとデータがあります）
                let sql_data13 = `DELETE from BusRoute WHERE BusRoute.projectId = ?`;
                var [query_result13, query_fields13] = await mysql_con.query(sql_data13, [event.pathParameters.projectId]);
                // 予約カテゴリー削除
                let sql_data7 = `DELETE from Category WHERE projectId = ?`;
                var [query_result7, query_fields7] = await mysql_con.query(sql_data7, [event.pathParameters.projectId]);
                // App削除
                let sql_data3 = `DELETE App from App LEFT OUTER JOIN Event ON App.eventId = Event.eventId WHERE Event.projectId = ?`;
                var [query_result3, query_fields3] = await mysql_con.query(sql_data3, [event.pathParameters.projectId]);
                // イベント削除
                let sql_data2 = `DELETE from Event WHERE projectId = ?`;
                var [query_result2, query_fields2] = await mysql_con.query(sql_data2, [event.pathParameters.projectId]);

                // その他
                // 予約削除
                // let sql_data14 = `DELETE from Reservation 
                // LEFT OUTER JOIN Event ON Category.eventId = Event.eventId WHERE Event.projectId = ?`;
                // var [query_result11, query_fields11] = await mysql_con.query(sql_data11, [event.pathParameters.projectId]);
                await mysql_con.commit();
                // success log
                await createLog(context, 'プロジェクト', '削除', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
                return {
                    statusCode: 200,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': '*',
                    },
                };
            }
        } catch (error) {
            await mysql_con.rollback();
            console.log(error);
            // failure log
            await createLog(context, 'プロジェクト', '削除', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(error),
            };
        }
    }
    else {
        console.log("invalid parameter");
        // failure log
        await createLog(context, 'プロジェクト', '削除', '失敗', '400', event.requestContext.identity.sourceIp, null, logAccountId, logData);
        return {
            statusCode: 400,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "*",
            },
            body: JSON.stringify({ "message": "invalid parameter" }),
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