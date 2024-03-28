/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk');
const mysql = require('mysql2/promise');
const bcrypt = require("bcryptjs");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

// Used to check password history
const PASSWORD_HISTORY_CHECK_COUNT = 3;

/**
 * ManagerAccountUpdate.
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

    if (event.pathParameters?.accountId) {
        let accountId = event.pathParameters.accountId;
        console.log("accountId:", accountId);
        const {
            fullName,
            roleId,
            email,
            initialPassword,
            isLocked,
            memo,
            updatedBy,
        } = JSON.parse(event.body);
        logAccountId = updatedBy;

        let mysql_con;
        try {
            // mysql connect
            mysql_con = await mysql.createConnection(writeDbConfig);
            await mysql_con.beginTransaction();

            // beforeDataの作成
            let beforeSql = `SELECT * FROM Account WHERE accountId = ?`;
            let [beforeResult] = await mysql_con.execute(beforeSql, [accountId]);
            // Found set already deleted
            if (beforeResult.length === 0) {
                console.log("Found set already deleted");
                await mysql_con.rollback();
                // failure log
                await createLog(context, 'アカウント', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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
            logData[0].fieldName = "アカウントID";
            logData[0].beforeValue = beforeResult[0].accountId;
            logData[0].afterValue = accountId;
            logData[1] = {};
            logData[1].fieldName = "アカウント名";
            logData[1].beforeValue = beforeResult[0].fullName;
            logData[1].afterValue = fullName;
            logData[2] = {};
            logData[2].fieldName = "ロール";
            logData[2].beforeValue = beforeResult[0].roleId;
            logData[2].afterValue = roleId;
            logData[3] = {};
            logData[3].fieldName = "メールアドレス";
            logData[3].beforeValue = beforeResult[0].email;
            logData[3].afterValue = email;
            logData[4] = {};
            logData[4].fieldName = "ロック状態";
            logData[4].beforeValue = beforeResult[0].isLocked;
            logData[4].afterValue = isLocked;
            logData[5] = {};
            logData[5].fieldName = "メモ";
            logData[5].beforeValue = beforeResult[0].memo;
            logData[5].afterValue = memo;

            let currentLoginFailureCountUpdateQuery = "";
            // Reset current login failure count when unlocking
            if (isLocked === 0) {
                let currentIsLocked = beforeResult[0].isLocked;
                if (currentIsLocked === 1) {
                    // Update the current login failure count to 0 only when changing from locked to unlocked
                    currentLoginFailureCountUpdateQuery = ", currentLoginFailureCount = 0";
                }
            }

            let sql_data;
            let sql_param = [];
            const updatedAt = Math.floor(new Date().getTime() / 1000);

            // If the password is not set, no need to update the it.
            if (!initialPassword || typeof initialPassword === 'undefined') {
                sql_data = `UPDATE Account SET 
                    fullName = ?,
                    roleId = ?,
                    email = ?,
                    isLocked = ?,
                    memo = ?,
                    updatedAt = ?,
                    updatedBy = ?
                    ${currentLoginFailureCountUpdateQuery}
                    WHERE accountId = ?;`;
                sql_param = [
                    fullName,
                    Number(roleId),
                    email,
                    Number(isLocked),
                    memo,
                    updatedAt,
                    updatedBy,
                    accountId
                ];
            }
            // The password needs to be updated
            else {
                sql_data = `UPDATE Account SET
                    fullName = ?,
                    roleId = ?,
                    email = ?,
                    passwordHistory = ?,
                    initialPassword = ?,
                    initialState = 1,
                    isLocked = ?,
                    passwordExpirationDate =  ?,
                    memo = ?,
                    updatedAt = ?,
                    updatedBy = ?
                    ${currentLoginFailureCountUpdateQuery}
                    WHERE accountId = ?;`;

                let get_hashed_password_sql_data = `SELECT passwordHistory FROM Account WHERE accountId = ?;`;
                let [password_result] = await mysql_con.execute(get_hashed_password_sql_data, [accountId]);
                // Found set already deleted
                if (password_result.length === 0) {
                    console.log("Found set already deleted");
                    await mysql_con.rollback();
                    // failure log
                    await createLog(context, 'アカウント', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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
                console.log('password_result:', password_result);
                let passwordHistory = password_result[0].passwordHistory;
                console.log('passwordHistory:', passwordHistory);

                let passwordAlreadyExists = false;
                for (let i = 0; i < passwordHistory.length; ++i) {
                    if (await bcrypt.compare(initialPassword, passwordHistory[i])) {
                        // The password has been used recently. It is not possible to reuse this password
                        passwordAlreadyExists = true;
                        break;
                    }
                }

                if (passwordAlreadyExists) {
                    // failure log
                    await createLog(context, 'アカウント', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
                    return {
                        statusCode: 400,
                        headers: {
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Headers': '*',
                        },
                        body: JSON.stringify({
                            message: `The password has been used in the past 3 times`,
                            errorCode: 202
                        }),
                    };
                }

                // Passwords do match and it has not been used recently. Proceed to update the information
                // Has the new password
                const hashedNewPassword = bcrypt.hashSync(initialPassword, 10);

                // Add the password at the beginning of the array
                passwordHistory.unshift(hashedNewPassword);

                // Delete the last record if it has more than 3 records
                if (passwordHistory.length > PASSWORD_HISTORY_CHECK_COUNT) {
                    passwordHistory.pop();
                }
                const expirationDays = 30;
                const nextTime = 1000 * 60 * 60 * 24 * expirationDays;
                const exp = new Date(Date.now() + nextTime).getTime();
                const unixtime = Math.floor(exp / 1000);

                sql_param = [
                    fullName,
                    Number(roleId),
                    email,
                    passwordHistory,
                    passwordHistory[0],
                    Number(isLocked),
                    unixtime,
                    memo,
                    updatedAt,
                    updatedBy,
                    accountId
                ];
            }

            let [query_result] = await mysql_con.execute(sql_data, sql_param);
            // // Found set already deleted
            // if (query_result.affectedRows == 0) {
            //     console.log("Found set already deleted");
            //     await mysql_con.rollback();
            //     // failure log
            //     await createLog(context, 'アカウント', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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

            await mysql_con.commit();
            // construct the response
            let response = {
                records: query_result[0]
            };
            console.log("response:", response);
            // success log
            await createLog(context, 'アカウント', '更新', '成功', '200', event.requestContext.identity.sourceIp, logAccountId, logData);
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
            await createLog(context, 'アカウント', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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
        await createLog(context, 'アカウント', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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
async function createLog(context, _target, _type, _result, _code, ipAddress, accountId, logData = null) {
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
            logData: logData
        }),
    };
    await lambda.invoke(params).promise();
}