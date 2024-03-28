/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerBroadcastUserAdd.
 * 
 * @param {*} event 
 * @returns {json} response
 */
exports.handler = async (event, context) => {
    console.log("Event data:", event);
    let logDataBroadcast = [];
    let logDataBroadcastUser = [];
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

    let {
        projectId,
        broadcastId,
        csvData,
        broadcastType,
        createdBy,
        updatedBy
    } = JSON.parse(event.body);
    logAccountId = updatedBy;

    let methodString = "";
    if (broadcastId && broadcastId !== 0) {
        methodString = "更新";
    } else {
        methodString = "作成";
    }

    if (!projectId) {
        let error = "invalid parameter. Project ID not found.";
        // failure log
        await createLog(context, '一斉送信', methodString, '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logDataBroadcast);
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
            await createLog(context, '一斉送信', methodString, '失敗', '403', event.requestContext.identity.sourceIp, projectId, logAccountId, logDataBroadcast);
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

    // updated date
    const updatedAt = Math.floor(new Date().getTime() / 1000);

    let beforeResultBroadcast;
    let query_result_broadcast;
    let query_result_broadcast_user;
    let mysql_con;
    try {
        // mysql connect
        mysql_con = await mysql.createConnection(writeDbConfig);
        await mysql_con.beginTransaction();

        // json parse csv
        let broadcastCSVDataList = JSON.parse(csvData);
        // console.log('broadcastCSVDataList',broadcastCSVDataList);
        let broadcastCount = broadcastCSVDataList?.length ?? 0;

        // UPDATE BROADCAST AND BROADCAST USER
        if (broadcastId && broadcastId !== 0) {
            let beforeSqlBroadcast = `SELECT * from Broadcast WHERE broadcastId = ? AND projectId = ?`;
            [beforeResultBroadcast] = await mysql_con.execute(beforeSqlBroadcast, [broadcastId, projectId]);
            console.log("beforeResultBroadcast:", beforeResultBroadcast);

            // update broadcast
            let sql_update_broadcast = `UPDATE Broadcast SET broadcastEditDatetime = ?, broadcastCount = ?, updatedAt = ?, updatedBy = ? WHERE broadcastId = ? AND projectId = ?;`;
            let param_update_broadcast = [
                updatedAt,
                broadcastCount,
                updatedAt,
                updatedBy,
                broadcastId,
                projectId
            ];
            console.log("sql_update_broadcast:", sql_update_broadcast);
            console.log("param_update_broadcast:", param_update_broadcast);

            [query_result_broadcast] = await mysql_con.execute(sql_update_broadcast, param_update_broadcast);

            logDataBroadcast[0] = {};
            logDataBroadcast[0].fieldName = "プロジェクトID";
            logDataBroadcast[0].beforeValue = beforeResultBroadcast[0].projectId;
            logDataBroadcast[0].afterValue = projectId;
            logDataBroadcast[1] = {};
            logDataBroadcast[1].fieldName = "一斉送信ID";
            logDataBroadcast[1].beforeValue = beforeResultBroadcast[0].broadcastId;
            logDataBroadcast[1].afterValue = broadcastId;
            logDataBroadcast[2] = {};
            logDataBroadcast[2].fieldName = "一斉送信編集日時";
            logDataBroadcast[2].beforeValue = beforeResultBroadcast[0].broadcastEditDatetime;
            logDataBroadcast[2].afterValue = updatedAt;
            logDataBroadcast[3] = {};
            logDataBroadcast[3].fieldName = "一斉送信送信人数";
            logDataBroadcast[3].beforeValue = beforeResultBroadcast[0].broadcastCount;
            logDataBroadcast[3].afterValue = broadcastCount;

            // delete broadcast user
            let sql_delete_broadcast_user = `DELETE FROM BroadcastUser WHERE broadcastId = ?;`;
            console.log("sql_delete_broadcast_user:", sql_delete_broadcast_user);

            [query_result_broadcast_user] = await mysql_con.execute(sql_delete_broadcast_user, [broadcastId]);
        }
        // CREATE NEW ONE
        else {
            // insert data query
            let sql_insert_broadcast = `INSERT INTO Broadcast (projectId, broadcastType, broadcastEditDatetime, broadcastCount, createdAt, createdBy, updatedAt, updatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`;
            let param_insert_broadcast = [
                projectId,
                broadcastType,
                updatedAt,
                broadcastCount,
                updatedAt,
                createdBy,
                updatedAt,
                updatedBy
            ];
            console.log("sql_insert_broadcast:", sql_insert_broadcast);
            console.log("param_insert_broadcast:", param_insert_broadcast);

            [query_result_broadcast] = await mysql_con.execute(sql_insert_broadcast, param_insert_broadcast);

            // get inserted Id
            broadcastId = query_result_broadcast.insertId;

            logDataBroadcast[0] = {};
            logDataBroadcast[0].fieldName = "プロジェクトID";
            logDataBroadcast[0].beforeValue = "";
            logDataBroadcast[0].afterValue = projectId;
            logDataBroadcast[1] = {};
            logDataBroadcast[1].fieldName = "一斉送信ID";
            logDataBroadcast[1].beforeValue = "";
            logDataBroadcast[1].afterValue = broadcastId;
            logDataBroadcast[2] = {};
            logDataBroadcast[2].fieldName = "一斉送信種別";
            logDataBroadcast[2].beforeValue = "";
            logDataBroadcast[2].afterValue = broadcastType;
            logDataBroadcast[3] = {};
            logDataBroadcast[3].fieldName = "一斉送信ステータス";
            logDataBroadcast[3].beforeValue = "";
            logDataBroadcast[3].afterValue = "";
            logDataBroadcast[4] = {};
            logDataBroadcast[4].fieldName = "一斉送信予約日時";
            logDataBroadcast[4].beforeValue = "";
            logDataBroadcast[4].afterValue = "";
            logDataBroadcast[5] = {};
            logDataBroadcast[5].fieldName = "一斉送信編集日時";
            logDataBroadcast[5].beforeValue = "";
            logDataBroadcast[5].afterValue = updatedAt;
            logDataBroadcast[6] = {};
            logDataBroadcast[6].fieldName = "一斉送信取り消し日時";
            logDataBroadcast[6].beforeValue = "";
            logDataBroadcast[6].afterValue = "";
            logDataBroadcast[7] = {};
            logDataBroadcast[7].fieldName = "一斉送信送信人数";
            logDataBroadcast[7].beforeValue = "";
            logDataBroadcast[7].afterValue = broadcastCount;
        }

        // If there is broadcast user list
        if (broadcastCSVDataList && broadcastCSVDataList.length > 0) {
            let sql_param2 = [];
            let existingDefaultArray = [broadcastId, updatedAt, createdBy, updatedAt, updatedBy];
            broadcastCSVDataList.map((row) => {
                sql_param2.push(existingDefaultArray.concat(row));
            });
            // Add null for missing parameters
            sql_param2.forEach((value, key) => {
                for (let index = value.length; index < 18; index++) {
                    value.push(null);
                }
            });

            let sql_data2 = `INSERT INTO BroadcastUser (
                broadcastId,
                createdAt,
                createdBy,
                updatedAt,
                updatedBy,
                broadcastLastName,
                broadcastFirstName,
                broadcastEmailAddress,
                broadcastTelNo,
                broadcastAddress,
                broadcastVarious1,
                broadcastVarious2,
                broadcastVarious3,
                broadcastVarious4,
                broadcastVarious5,
                broadcastVarious6,
                broadcastVarious7,
                broadcastVarious8
                ) VALUES ?`;
            console.log('sql_data2', sql_data2);
            console.log('sql_param2', sql_param2);

            [query_result_broadcast_user] = await mysql_con.query(sql_data2, [sql_param2], function (err, result) {
                if (err) {
                    console.log('err', err);
                    mysql_con.rollback();
                    // failure log
                    createLog(context, '一斉送信ユーザー', methodString, '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logDataBroadcastUser);
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
                console.log('result', result);
            });

            logDataBroadcastUser[0] = {};
            logDataBroadcastUser[0].fieldName = "一斉送信ID";
            logDataBroadcastUser[0].beforeValue = broadcastId;
            logDataBroadcastUser[0].afterValue = broadcastId;
            logDataBroadcastUser[1] = {};
            logDataBroadcastUser[1].fieldName = "一斉送信送信人数";
            logDataBroadcastUser[1].beforeValue = beforeResultBroadcast ? beforeResultBroadcast[0].broadcastCount : 0;
            logDataBroadcastUser[1].afterValue = query_result_broadcast_user.affectedRows;
        }

        await mysql_con.commit();

        // construct the response
        let response = {
            records: query_result_broadcast_user
        };
        // success log
        await createLog(context, '一斉送信', methodString, '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logDataBroadcast);
        await createLog(context, '一斉送信ユーザー', methodString, '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logDataBroadcastUser);
        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "*",
            },
            body: JSON.stringify(response),
        };
    } catch (error) {
        console.log("error:", error);
        await mysql_con.rollback();
        // failure log
        await createLog(context, '一斉送信ユーザー', methodString, '失敗', '400', event.requestContext.identity.sourceIp, null, logAccountId, logDataBroadcast);
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