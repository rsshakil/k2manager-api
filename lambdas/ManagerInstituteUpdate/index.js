/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerInstituteUpdate.
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
        instituteName,
        instituteManageName,
        instituteOverview,
        instituteDescription,
        instituteZipCode,
        institutePrefecture,
        instituteCityName,
        instituteTownName,
        instituteAddressName,
        instituteBuilding,
        instituteTelNo,
        instituteLatlong,
        instituteImageURL1,
        instituteImageURL2,
        instituteImageURL3,
        memo,
        updatedBy,
    } = JSON.parse(event.body);
    logAccountId = updatedBy;

    if (event.pathParameters?.instituteId) {
        let instituteId = event.pathParameters.instituteId;
        console.log("instituteId:", instituteId);

        if (!projectId) {
            // failure log
            await createLog(context, 'イベント施設', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
                await createLog(context, 'イベント施設', '更新', '失敗', '403', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
            let beforeSql = `SELECT * FROM Institute WHERE instituteId = ? AND projectId = ?`;
            let [beforeResult] = await mysql_con.execute(beforeSql, [instituteId, projectId]);
            // Found set already deleted
            if (beforeResult.length === 0) {
                await mysql_con.rollback();
                console.log("Found set already deleted");
                // failure log
                await createLog(context, 'イベント施設', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
            logData[1].fieldName = "施設名";
            logData[1].beforeValue = beforeResult[0].instituteName;
            logData[1].afterValue = instituteName;
            logData[2] = {};
            logData[2].fieldName = "施設管理名";
            logData[2].beforeValue = beforeResult[0].instituteManageName;
            logData[2].afterValue = instituteManageName;
            logData[3] = {};
            logData[3].fieldName = "施設説明";
            logData[3].beforeValue = beforeResult[0].instituteOverview;
            logData[3].afterValue = instituteOverview;
            logData[4] = {};
            logData[4].fieldName = "施設説明";
            logData[4].beforeValue = beforeResult[0].instituteDescription;
            logData[4].afterValue = instituteDescription;
            logData[5] = {};
            logData[5].fieldName = "施設郵便番号";
            logData[5].beforeValue = beforeResult[0].instituteZipCode;
            logData[5].afterValue = instituteZipCode;
            logData[6] = {};
            logData[6].fieldName = "施設都道府県";
            logData[6].beforeValue = beforeResult[0].institutePrefecture;
            logData[6].afterValue = institutePrefecture;
            logData[7] = {};
            logData[7].fieldName = "施設市区町村";
            logData[7].beforeValue = beforeResult[0].instituteCityName;
            logData[7].afterValue = instituteCityName;
            logData[8] = {};
            logData[8].fieldName = "施設住所1";
            logData[8].beforeValue = beforeResult[0].instituteTownName;
            logData[8].afterValue = instituteTownName;
            logData[9] = {};
            logData[9].fieldName = "施設住所2";
            logData[9].beforeValue = beforeResult[0].instituteAddressName;
            logData[9].afterValue = instituteAddressName;
            logData[10] = {};
            logData[10].fieldName = "施設住所3";
            logData[10].beforeValue = beforeResult[0].instituteBuilding;
            logData[10].afterValue = instituteBuilding;
            logData[11] = {};
            logData[11].fieldName = "施設電話番号";
            logData[11].beforeValue = beforeResult[0].instituteTelNo;
            logData[11].afterValue = instituteTelNo;
            logData[12] = {};
            logData[12].fieldName = "施設緯度経度";
            logData[12].beforeValue = beforeResult[0].instituteLatlong;
            logData[12].afterValue = instituteLatlong;
            logData[13] = {};
            logData[13].fieldName = "施設画像1";
            logData[13].beforeValue = beforeResult[0].instituteImageURL1;
            logData[13].afterValue = instituteImageURL1;
            logData[14] = {};
            logData[14].fieldName = "施設画像2";
            logData[14].beforeValue = beforeResult[0].instituteImageURL2;
            logData[14].afterValue = instituteImageURL2;
            logData[15] = {};
            logData[15].fieldName = "施設画像3";
            logData[15].beforeValue = beforeResult[0].instituteImageURL3;
            logData[15].afterValue = instituteImageURL3;
            logData[16] = {};
            logData[16].fieldName = "メモ";
            logData[16].beforeValue = beforeResult[0].memo;
            logData[16].afterValue = memo;

            const updatedAt = Math.floor(new Date().getTime() / 1000);
            let sql_data = `UPDATE Institute SET
                instituteName = ?,
                instituteManageName = ?,
                instituteOverview = ?,
                instituteDescription = ?,
                instituteZipCode = ?,
                institutePrefecture = ?,
                instituteCityName = ?,
                instituteTownName = ?,
                instituteAddressName = ?,
                instituteBuilding = ?,
                instituteTelNo = ?,
                instituteLatlong = ?,
                instituteImageURL1 = ?,
                instituteImageURL2 = ?,
                instituteImageURL3 = ?,
                memo = ?,
                updatedAt = ?,
                updatedBy = ?
                WHERE instituteId = ? AND projectId = ?;`;
            let sql_param = [
                instituteName,
                instituteManageName,
                instituteOverview,
                instituteDescription,
                instituteZipCode,
                institutePrefecture,
                instituteCityName,
                instituteTownName,
                instituteAddressName,
                instituteBuilding,
                instituteTelNo,
                instituteLatlong,
                instituteImageURL1,
                instituteImageURL2,
                instituteImageURL3,
                memo,
                updatedAt,
                updatedBy,
                instituteId,
                projectId
            ];
            console.log("sql_data:", sql_data);
            console.log("sql_param:", sql_param);

            let [query_result] = await mysql_con.execute(sql_data, sql_param);
            // // Found set already deleted
            // if (query_result.affectedRows == 0) {
            //     await mysql_con.rollback();
            //     console.log("Found set already deleted");
            //     // failure log
            //     await createLog(context, 'イベント施設', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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
                '[施設] ' + instituteName,
                updatedAt,
                updatedBy,
                projectId,
                instituteId,
                'Institute.instituteId'
            ]);
            if (query_result2.length === 0) {
                // failure log
                await createLog(context, 'イベント施設', '更新', '失敗', '404', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
            // success log
            await createLog(context, 'イベント施設', '更新', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
            await createLog(context, 'イベント施設', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
        await createLog(context, 'イベント施設', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
