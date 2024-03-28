/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerEventInstituteCreate.
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

    let mysql_con;
    try {
        const {
            eventCategoryId,
            instituteId,
            eventInstituteName,
            eventInstituteItemType,
            eventInstituteSlotType,
            eventInstituteSlotStyleTimePattern,
            eventInstituteSlotStyleRangeTime,
            eventInstituteSlotStyle,
            mappingInterval,
            mappingStartTime,
            mappingEndTime,
            filterId,
            eventInstituteDentalFlag,
            memo,
            createdBy,
            updatedBy
        } = JSON.parse(event.body);
        logAccountId = createdBy;
        let eventInstituteSlotStyleObject = {};
        if (eventInstituteSlotType == 0) {
            eventInstituteSlotStyleObject = {
                eventInstituteSlotStyleTimePattern: eventInstituteSlotStyleTimePattern,
                eventInstituteSlotStyleRangeTime: eventInstituteSlotStyleRangeTime,
                mappingInterval: mappingInterval,
                mappingStartTime: Number(mappingStartTime),
                mappingEndTime: Number(mappingEndTime),
            };
        }
        else if (eventInstituteSlotType == 1) {
            eventInstituteSlotStyleObject = eventInstituteSlotStyle;
        }
        else if (eventInstituteSlotType == 2) {
            eventInstituteSlotStyleObject = eventInstituteSlotStyle;
        }
        else {
            console.log("invalid parameter [eventInstituteSlotType]:", eventInstituteSlotType);
            // failure log
            await createLog(context, 'イベント施設', '作成', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
            return {
                statusCode: 400,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "*",
                },
                body: JSON.stringify({message : "invalid parameter: eventInstituteSlotType"}),
            };
        }

        // mysql connect
        mysql_con = await mysql.createConnection(writeDbConfig);
        let sql_event = `SELECT eventStartDate, eventEndDate FROM Event 
        LEFT OUTER JOIN EventCategory ON Event.eventId = EventCategory.eventId
        WHERE eventCategoryId = ?`;
        var [query_result2] = await mysql_con.query(sql_event, [eventCategoryId]);
        let eventStartDate = query_result2[0].eventStartDate;
        let eventEndDate = query_result2[0].eventEndDate;

        // ログ書き込み
        logData[0] = {};
        logData[0].fieldName = "イベント予約カテゴリーID";
        logData[0].beforeValue = "";
        logData[0].afterValue = eventCategoryId;
        logData[1] = {};
        logData[1].fieldName = "イベント施設ID";
        logData[1].beforeValue = "";
        logData[1].afterValue = instituteId;
        logData[2] = {};
        logData[2].fieldName = "イベント施設名";
        logData[2].beforeValue = "";
        logData[2].afterValue = eventInstituteName;
        logData[3] = {};
        logData[3].fieldName = "イベント施設開始日時";
        logData[3].beforeValue = "";
        logData[3].afterValue = eventStartDate;
        logData[4] = {};
        logData[4].fieldName = "イベント施設終了日時";
        logData[4].beforeValue = "";
        logData[4].afterValue = eventEndDate;
        logData[5] = {};
        logData[5].fieldName = "イベント施設アイテムタイプ";
        logData[5].beforeValue = "";
        logData[5].afterValue = eventInstituteItemType;
        logData[6] = {};
        logData[6].fieldName = "イベント施設枠タイプ";
        logData[6].beforeValue = "";
        logData[6].afterValue = eventInstituteSlotType;
        logData[7] = {};
        logData[7].fieldName = "イベント施設データ";
        logData[7].beforeValue = "";
        logData[7].afterValue = eventInstituteSlotStyleObject;
        logData[8] = {};
        logData[8].fieldName = "イベント施設表示選択条件フィルター";
        logData[8].beforeValue = "";
        logData[8].afterValue = filterId;
        logData[9] = {};
        logData[9].fieldName = "イベント施設メモ";
        logData[9].beforeValue = "";
        logData[9].afterValue = memo;

        // insert data query
        let sql_data = `INSERT INTO EventInstitute (
            eventCategoryId,
            instituteId,
            eventInstituteName,
            eventInstituteItemType,
            eventInstituteStartDate,
            eventInstituteEndDate,
            eventInstituteSlotType,
            eventInstituteSlotStyle,
            filterId,
            eventInstituteDentalFlag,
            memo3,
            createdAt,
            createdBy,
            updatedAt,
            updatedBy
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`;
        // created date
        const createdAt = Math.floor(new Date().getTime() / 1000);
        let sql_param = [
            eventCategoryId,
            instituteId,
            eventInstituteName,
            eventInstituteItemType,
            eventStartDate,
            eventEndDate,
            eventInstituteSlotType,
            eventInstituteSlotStyleObject,
            filterId,
            eventInstituteDentalFlag,
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
            await createLog(context, 'イベント施設', '作成', '失敗', '404', event.requestContext.identity.sourceIp, logAccountId, logData);
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
        // construct the response
        let response = {
            records: query_result[0]
        };
        // console.log("response:", response);
        // success log
        await createLog(context, 'イベント施設', '作成', '成功', '200', event.requestContext.identity.sourceIp, logAccountId, logData);
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
        // failure log
        await createLog(context, 'イベント施設', '作成', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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