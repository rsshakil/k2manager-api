/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerEventInstituteUpdate.
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

    if (event.pathParameters?.eventInstituteId) {
        let eventInstituteId = event.pathParameters.eventInstituteId;
        console.log("eventInstituteId:", eventInstituteId);
        const {
            instituteId,
            eventInstituteName,
            eventInstituteSlotType,
            eventInstituteSlotStyle,
            filterId,
            eventInstituteDentalFlag,
            memo,
            updatedBy
        } = JSON.parse(event.body);
        logAccountId = updatedBy;
        const updatedAt = Math.floor(new Date().getTime() / 1000);

        let eventInstituteSlotStyleObject = {};
        let sql_data = "";
        let sql_param = "";
        if (eventInstituteSlotType == 0) {
            sql_data = `UPDATE EventInstitute SET 
                instituteId = ?,
                eventInstituteName = ?,
                filterId = ?,
                eventInstituteDentalFlag = ?,
                memo3 = ?,
                updatedAt = ?,
                updatedBy = ?
                WHERE eventInstituteId = ?`;
            sql_param = [
                instituteId,
                eventInstituteName,
                filterId,
                eventInstituteDentalFlag,
                memo,
                updatedAt,
                updatedBy,
                eventInstituteId
            ];
        }
        else if (eventInstituteSlotType == 1) {
            eventInstituteSlotStyleObject = eventInstituteSlotStyle;
            sql_data = `UPDATE EventInstitute SET
                instituteId = ?,
                eventInstituteName = ?,
                eventInstituteSlotStyle = ?,
                filterId = ?,
                eventInstituteDentalFlag = ?,
                memo3 = ?,
                updatedAt = ?,
                updatedBy = ?
                WHERE eventInstituteId = ?`;
            sql_param = [
                instituteId,
                eventInstituteName,
                eventInstituteSlotStyleObject,
                filterId,
                eventInstituteDentalFlag,
                memo,
                updatedAt,
                updatedBy,
                eventInstituteId
            ];
        }
        else if (eventInstituteSlotType == 2) {
            eventInstituteSlotStyleObject = eventInstituteSlotStyle;
            sql_data = `UPDATE EventInstitute SET 
                instituteId = ?,
                eventInstituteName = ?,
                eventInstituteSlotStyle = ?,
                filterId = ?,
                eventInstituteDentalFlag = ?,
                memo3 = ?,
                updatedAt = ?,
                updatedBy = ?
                WHERE eventInstituteId = ?`;
            sql_param = [
                instituteId,
                eventInstituteName,
                eventInstituteSlotStyleObject,
                filterId,
                eventInstituteDentalFlag,
                memo,
                updatedAt,
                updatedBy,
                eventInstituteId
            ];
        }

        console.log("sql_data:", sql_data);
        console.log("sql_param:", sql_param);

        let mysql_con;
        try {
            // mysql connect
            mysql_con = await mysql.createConnection(writeDbConfig);
            await mysql_con.beginTransaction();
            // beforeDataの作成
            let beforeSql = `SELECT * FROM EventInstitute WHERE eventInstituteId = ?`;
            let [beforeResult] = await mysql_con.execute(beforeSql, [eventInstituteId]);
            // Found set already deleted
            if (beforeResult.length === 0) {
                await mysql_con.rollback();
                // failure log
                await createLog(context, 'イベント施設', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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
            logData[0].fieldName = "イベント予約カテゴリーID";
            logData[0].beforeValue = beforeResult[0].eventCategoryId;
            logData[0].afterValue = beforeResult[0].eventCategoryId;
            logData[1] = {};
            logData[1].fieldName = "イベント施設ID";
            logData[1].beforeValue = beforeResult[0].instituteId;
            logData[1].afterValue = instituteId;
            logData[2] = {};
            logData[2].fieldName = "イベント施設名";
            logData[2].beforeValue = beforeResult[0].eventInstituteName;
            logData[2].afterValue = eventInstituteName;
            logData[3] = {};
            logData[3].fieldName = "イベント施設開始日時";
            logData[3].beforeValue = beforeResult[0].eventInstituteStartDate;
            logData[3].afterValue = beforeResult[0].eventInstituteStartDate;
            logData[4] = {};
            logData[4].fieldName = "イベント施設終了日時";
            logData[4].beforeValue = beforeResult[0].eventInstituteEndDate;
            logData[4].afterValue = beforeResult[0].eventInstituteEndDate;
            logData[5] = {};
            logData[5].fieldName = "イベント施設アイテムタイプ";
            logData[5].beforeValue = beforeResult[0].eventInstituteItemType;
            logData[5].afterValue = beforeResult[0].eventInstituteItemType;
            logData[6] = {};
            logData[6].fieldName = "イベント施設枠タイプ";
            logData[6].beforeValue = beforeResult[0].eventInstituteSlotType;
            logData[6].afterValue = eventInstituteSlotType;
            logData[7] = {};
            logData[7].fieldName = "イベント施設データ";
            logData[7].beforeValue = beforeResult[0].eventInstituteSlotStyle;
            logData[7].afterValue = eventInstituteSlotStyle;
            logData[8] = {};
            logData[8].fieldName = "イベント施設表示選択条件フィルター";
            logData[8].beforeValue = beforeResult[0].filterId;
            logData[8].afterValue = filterId;
            logData[9] = {};
            logData[9].fieldName = "イベント施設メモ";
            logData[9].beforeValue = beforeResult[0].memo3;
            logData[9].afterValue = memo;

            let [query_result] = await mysql_con.execute(sql_data, sql_param);

            await mysql_con.commit();
            // construct the response
            let response = {
                records: query_result[0]
            };
            console.log("response:", response);
            // success log
            await createLog(context, 'イベント施設', '更新', '成功', '200', event.requestContext.identity.sourceIp, logAccountId, logData);
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
            await createLog(context, 'イベント施設', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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
        await createLog(context, 'イベント施設', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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