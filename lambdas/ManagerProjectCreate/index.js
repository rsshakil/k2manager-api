/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerProjectCreate.
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
        projectCode,
        projectName,
        projectStatus,
        projectCsvCharacterCode,
        memo,
        createdBy,
        updatedBy
    } = JSON.parse(event.body);
    logAccountId = createdBy;
    let mysql_con;
    // コピー処理
    // APP、イベント、フィルター、フィールド、予約カテゴリー、アイテム、カウンセラー、施設、バス
    if (event.pathParameters?.projectId) {
        try {
            let validProjectId;
            if (event?.requestContext?.authorizer?.pid) {
                validProjectId = JSON.parse(event?.requestContext?.authorizer?.pid);
                // 許可プロジェクトIDに含まれていない場合
                if (validProjectId.indexOf(Number(event.pathParameters?.projectId)) == -1) {
                    // failure log
                    await createLog(context, 'プロジェクト', '複製', '失敗', '403', event.requestContext.identity.sourceIp, logAccountId, logData);
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

            // regist view code
            let params = {
                FunctionName: "getviewcode-" + process.env.ENV,
                InvocationType: "RequestResponse"
            };
            // mysql connect
            mysql_con = await mysql.createConnection(writeDbConfig);
            await mysql_con.beginTransaction();
            let projectId = event.pathParameters?.projectId;
            // プロジェクトのコピー
            let copy_base_sql = `SELECT * FROM Project WHERE projectId = ?`;
            let [query_base_result] = await mysql_con.query(copy_base_sql, [projectId]);
            let projectName = query_base_result[0].projectName + '（コピー）';
            let code = await lambda.invoke(params).promise();
            let projectCode = JSON.parse(code.Payload);
            const createdAt = Math.floor(new Date().getTime() / 1000);
            let copy_out_sql = `INSERT INTO Project(projectName, projectCode, projectStatus,projectCsvCharacterCode, createdAt, createdBy, updatedAt, updatedBy) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`;
            let [query_copy_result] = await mysql_con.query(copy_out_sql, [projectName, projectCode, 0,projectCsvCharacterCode, createdAt, createdBy, createdAt, createdBy]);
            let newProjectId = query_copy_result.insertId;
            // ログ書き込み
            logData[0] = {};
            logData[0].fieldName = "プロジェクトID";
            logData[0].beforeValue = projectId;
            logData[0].afterValue = newProjectId;
            // イベントのコピー
            copy_base_sql = `SELECT * FROM Event WHERE projectId = ?`;
            [query_base_result] = await mysql_con.query(copy_base_sql, [projectId]);
            for (let i = 0; i < query_base_result.length; i++) {
                let eventName = query_base_result[i].eventName;
                let eventOverview = query_base_result[i].eventOverview;
                let eventDescription = query_base_result[i].eventDescription;
                let eventStartDate = query_base_result[i].eventStartDate;
                let eventEndDate = query_base_result[i].eventEndDate;
                let eventImageURL1 = query_base_result[i].eventImageURL1;
                let eventImageURL2 = query_base_result[i].eventImageURL2;
                let eventImageURL3 = query_base_result[i].eventImageURL3;
                code = await lambda.invoke(params).promise();
                copy_out_sql = `INSERT INTO Event(projectId, eventName, eventOverview, eventDescription, eventStartDate, eventEndDate, eventImageURL1, eventImageURL2, eventImageURL3, 
                createdAt, createdBy, updatedAt, updatedBy) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                [query_copy_result] = await mysql_con.query(copy_out_sql, [newProjectId, eventName, eventOverview, eventDescription, eventStartDate, eventEndDate, eventImageURL1, eventImageURL2, eventImageURL3,
                    createdAt, createdBy, createdAt, createdBy]);
                let newEventId = query_copy_result.insertId;
                // APPのコピー
                let copy_base_sql2 = `SELECT * FROM App WHERE eventId = ?`;
                let [query_base_result2] = await mysql_con.query(copy_base_sql2, [query_base_result[i].eventId]);
                for (let j = 0; j < query_base_result2.length; j++) {
                    let appName = query_base_result2[j].appName;
                    code = await lambda.invoke(params).promise();
                    let appCode = JSON.parse(code.Payload);
                    copy_out_sql = `INSERT INTO App(eventId, appName, appCode
                    createdAt, createdBy, updatedAt, updatedBy) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                    let [query_copy_result2] = await mysql_con.query(copy_out_sql, [newEventId, appName, appCode, createdAt, createdBy, createdAt, createdBy]);
                }
            }
            // 予約カテゴリーのコピー
            copy_base_sql = `SELECT * FROM Category WHERE projectId = ?`;
            [query_base_result] = await mysql_con.query(copy_base_sql, [projectId]);
            for (let i = 0; i < query_base_result.length; i++) {
                let categoryName = query_base_result[i].categoryName;
                let categoryOverview = query_base_result[i].categoryOverview;
                let categoryDescription = query_base_result[i].categoryDescription;
                let categoryImageURL1 = query_base_result[i].categoryImageURL1;
                let categoryImageURL2 = query_base_result[i].categoryImageURL2;
                let categoryImageURL3 = query_base_result[i].categoryImageURL3;
                copy_out_sql = `INSERT INTO Category(projectId, categoryName, categoryOverview, categoryDescription, categoryImageURL1, categoryImageURL2, categoryImageURL3, 
                createdAt, createdBy, updatedAt, updatedBy) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                [query_copy_result] = await mysql_con.query(copy_out_sql, [newProjectId, categoryName, categoryOverview, categoryDescription, categoryImageURL1, categoryImageURL2, categoryImageURL3,
                    createdAt, createdBy, createdAt, createdBy]);
            }
            // 施設のコピー
            copy_base_sql = `SELECT * FROM Institute WHERE projectId = ?`;
            [query_base_result] = await mysql_con.query(copy_base_sql, [projectId]);
            for (let i = 0; i < query_base_result.length; i++) {
                code = await lambda.invoke(params).promise();
                let instituteCode = JSON.parse(code.Payload);
                let instituteName = query_base_result[i].instituteName;
                let instituteOverview = query_base_result[i].instituteOverview;
                let instituteDescription = query_base_result[i].instituteDescription;
                let instituteZipCode = query_base_result[i].instituteZipCode;
                let institutePrefecture = query_base_result[i].institutePrefecture;
                let instituteCityName = query_base_result[i].instituteCityName;
                let instituteTownName = query_base_result[i].instituteTownName;
                let instituteAddressName = query_base_result[i].instituteAddressName;
                let instituteBuilding = query_base_result[i].instituteBuilding;
                let instituteTelNo = query_base_result[i].instituteTelNo;
                let instituteLatlong = query_base_result[i].instituteLatlong;
                let instituteImageURL1 = query_base_result[i].instituteImageURL1;
                let instituteImageURL2 = query_base_result[i].instituteImageURL2;
                let instituteImageURL3 = query_base_result[i].instituteImageURL3;
                copy_out_sql = `INSERT INTO Institute(projectId, instituteCode, instituteName, instituteOverview, instituteDescription, instituteZipCode, institutePrefecture, 
                instituteCityName, instituteTownName, instituteAddressName, instituteBuilding, instituteTelNo, instituteLatlong, instituteImageURL1, instituteImageURL2, instituteImageURL3,
                createdAt, createdBy, updatedAt, updatedBy) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                [query_copy_result] = await mysql_con.query(copy_out_sql, [newProjectId, instituteCode, instituteName, instituteOverview, instituteDescription, instituteZipCode, institutePrefecture,
                    instituteCityName, instituteTownName, instituteAddressName, instituteBuilding, instituteTelNo, instituteLatlong, instituteImageURL1, instituteImageURL2, instituteImageURL3,
                    createdAt, createdBy, createdAt, createdBy]);
            }
            // アイテムのコピー
            copy_base_sql = `SELECT * FROM Item WHERE projectId = ?`;
            [query_base_result] = await mysql_con.query(copy_base_sql, [projectId]);
            for (let i = 0; i < query_base_result.length; i++) {
                let itemManageName = query_base_result[i].itemManageName;
                let itemName = query_base_result[i].itemName;
                let itemOverview = query_base_result[i].itemOverview;
                let itemDescription = query_base_result[i].itemDescription;
                let itemImageURL1 = query_base_result[i].itemImageURL1;
                let itemImageURL2 = query_base_result[i].itemImageURL2;
                let itemImageURL3 = query_base_result[i].itemImageURL3;
                let filterId = query_base_result[i].filterId;
                copy_out_sql = `INSERT INTO Item(projectId, itemManageName, itemName, itemOverview, itemDescription, itemImageURL1, itemImageURL2, itemImageURL3, 
                createdAt, createdBy, updatedAt, updatedBy) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                [query_copy_result] = await mysql_con.query(copy_out_sql, [newProjectId, itemManageName, itemName, itemOverview, itemDescription, itemImageURL1, itemImageURL2, itemImageURL3,
                    createdAt, createdBy, createdAt, createdBy]);
            }
            // カウンセラーのコピー
            copy_base_sql = `SELECT * FROM Counselor WHERE projectId = ?`;
            [query_base_result] = await mysql_con.query(copy_base_sql, [projectId]);
            for (let i = 0; i < query_base_result.length; i++) {
                let counselorManageName = query_base_result[i].counselorManageName;
                let counselorName = query_base_result[i].counselorName;
                let counselorOverview = query_base_result[i].counselorOverview;
                let counselorDescription = query_base_result[i].counselorDescription;
                let counselorImageURL1 = query_base_result[i].counselorImageURL1;
                let counselorImageURL2 = query_base_result[i].counselorImageURL2;
                let counselorImageURL3 = query_base_result[i].counselorImageURL3;
                let filterId = query_base_result[i].filterId;
                copy_out_sql = `INSERT INTO Counselor(projectId, counselorManageName, counselorName, counselorOverview, counselorDescription, counselorImageURL1, counselorImageURL2, counselorImageURL3, 
                createdAt, createdBy, updatedAt, updatedBy) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                [query_copy_result] = await mysql_con.query(copy_out_sql, [newProjectId, counselorManageName, counselorName, counselorOverview, counselorDescription, counselorImageURL1, counselorImageURL2, counselorImageURL3,
                    createdAt, createdBy, createdAt, createdBy]);
            }
            // フィルターのコピー
            copy_base_sql = `SELECT * FROM Filter WHERE projectId = ?`;
            [query_base_result] = await mysql_con.query(copy_base_sql, [projectId]);
            for (let i = 0; i < query_base_result.length; i++) {
                let filterName = query_base_result[i].filterName;
                let filterOverview = query_base_result[i].filterOverview;
                let filterQuery = query_base_result[i].filterQuery;
                copy_out_sql = `INSERT INTO Filter(projectId, filterName, filterOverview, filterQuery, createdAt, createdBy, updatedAt, updatedBy) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`;
                [query_copy_result] = await mysql_con.query(copy_out_sql, [newProjectId, filterName, filterOverview, JSON.stringify(filterQuery), createdAt, createdBy, createdAt, createdBy]);
            }
            // フィールドのコピー
            copy_base_sql = `SELECT * FROM Field WHERE projectId = ?`;
            [query_base_result] = await mysql_con.query(copy_base_sql, [projectId]);
            for (let i = 0; i < query_base_result.length; i++) {
                let fieldName = query_base_result[i].fieldName;
                code = await lambda.invoke(params).promise();
                let fieldCode = JSON.parse(code.Payload);
                let fieldOverview = query_base_result[i].fieldOverview;
                let fieldDescription = query_base_result[i].fieldDescription;
                let fieldType = query_base_result[i].fieldType;
                let fieldStyle = query_base_result[i].fieldStyle;
                let filterId = query_base_result[i].filterId;
                copy_out_sql = `INSERT INTO Field(projectId, fieldName, fieldCode, fieldOverview, fieldDescription, fieldType, fieldStyle, filterId, 
                createdAt, createdBy, updatedAt, updatedBy) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                [query_copy_result] = await mysql_con.query(copy_out_sql, [newProjectId, fieldName, fieldCode, fieldOverview, fieldDescription, fieldType, JSON.stringify(fieldStyle), filterId, createdAt, createdBy, createdAt, createdBy]);
            }
            // バスのコピー
            /*
                        copy_base_sql = `SELECT * FROM BusRoute WHERE projectId = ?`;
                        query_base_result = await mysql_con.query(copy_base_sql, [projectId]);
                        for (let i = 0; i < query_base_result.length; i++) {
                            let busRouteName = query_base_result[i].busRouteName;
                            let busRouteCode = JSON.parse(await lambda.invoke(params).promise()?.Payload);
                            let busRouteOverview = query_base_result[i].busRouteOverview;
                            let busRouteDescription = query_base_result[i].busRouteDescription;
                            let busRouteImageURL1 = query_base_result[i].busRouteImageURL1;
                            let busRouteImageURL2 = query_base_result[i].busRouteImageURL2;
                            let busRouteImageURL3 = query_base_result[i].busRouteImageURL3;
                            copy_out_sql = `INSERT INTO BusRoute(projectId, busRouteName, busRouteCode, busRouteOverview, busRouteDescription, 
                            busRouteImageURL1, busRouteImageURL2, busRouteImageURL3, createdAt, createdBy, updatedAt, updatedBy) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                            query_copy_result = await mysql_con.query(copy_out_sql, [newProjectId, busRouteName, busRouteCode, busRouteOverview, busRouteDescription, 
                            busRouteImageURL1, busRouteImageURL2, busRouteImageURL3, createdAt, createdBy, createdAt, createdBy]);
                            let newBusRouteId = query_copy_result.insertId;
                            // バス停留所のコピー
                            copy_base_sql2 = `SELECT * FROM BusStop WHERE busRouteId = ?`;
                            query_base_result2 = await mysql_con.query(copy_base_sql2, [query_base_result[i].busRouteId]);
                            for (let j = 0; j < query_base_result2.length; j++) {
                                let busStopName = query_base_result2[j].busStopName;
                                let busStopAddress = query_base_result2[j].busStopAddress;
                                copy_out_sql = `INSERT INTO BusStop(projectId, busRouteId, busStopName, busStopAddress, createdAt, createdBy, updatedAt, updatedBy) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`;
                                query_copy_result = await mysql_con.query(copy_out_sql, [newProjectId, newBusRouteId, busStopName, busStopAddress, createdAt, createdBy, createdAt, createdBy]);
                            }
                            // バス便のコピー
                            copy_base_sql2 = `SELECT * FROM BusWay WHERE busRouteId = ?`;
                            let query_base_result2 = await mysql_con.query(copy_base_sql2, [query_base_result[i].busRouteId]);
                            for (let j = 0; j < query_base_result2.length; j++) {
                                let busWayName = query_base_result2[j].busWayName;
                                let busWayOverview = query_base_result2[j].busWayOverview;
                                let busWayCapacity = query_base_result2[j].busWayCapacity;
                                copy_out_sql = `INSERT INTO BusWay(busRouteId, busWayName, busWayOverview, busWayCapacity, createdAt, createdBy, updatedAt, updatedBy) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`;
                                let query_copy_result2 = await mysql_con.query(copy_out_sql, [newBusRouteId, busWayName, busWayOverview, busWayCapacity, createdAt, createdBy, createdAt, createdBy]);
                            }
                            // バス便
                            copy_base_sql2 = `SELECT * FROM BusStop WHERE busRouteId = ?`
                            query_base_result2 = await mysql_con.query(copy_base_sql2, [query_base_result[i].busRouteId]);
                            for (let j = 0; j < query_base_result2.length; j++) {
                                let copy_base_sql3 = `SELECT * FROM BusWay WHERE busRouteId = ?`
                                let query_base_result3 = await mysql_con.query(copy_base_sql3, [query_base_result[i].busRouteId]);
                                for (let k = 0; k < query_base_result3.length; k++) {
                                    let copy_base_sql4 = `SELECT * FROM BusTimeTable WHERE busStopId = ? AND busWayId = ?`
                                    let query_base_result4 = await mysql_con.query(copy_base_sql4, [query_base_result2[j].busStopId, query_base_result3[k].busWayId]);
                                    copy_out_sql = `INSERT INTO BusTimeTable(busWayId, busStopId, busTime, busStopAddress, createdAt, createdBy, updatedAt, updatedBy) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`;
                                    query_copy_result = await mysql_con.query(copy_out_sql, [newProjectId, newBusRouteId, busStopName, busStopAddress, createdAt, createdBy, createdAt, createdBy]);
                                }
                            }
                        }
            */
            await mysql_con.commit();
            // success log
            await createLog(context, 'プロジェクト', '複製', '成功', '200', event.requestContext.identity.sourceIp, logAccountId, logData);
            return {
                statusCode: 200,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "*",
                },
                body: JSON.stringify({ message: "success" }),
            };
        } catch (error) {
            await mysql_con.rollback();
            console.log("error:", error);
            // failure log
            await createLog(context, 'プロジェクト', '複製', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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
    }
    else {
        // ログ書き込み
        logData[0] = {};
        logData[0].fieldName = "プロジェクトコード";
        logData[0].beforeValue = "";
        logData[0].afterValue = projectCode;
        logData[1] = {};
        logData[1].fieldName = "プロジェクト名";
        logData[1].beforeValue = "";
        logData[1].afterValue = projectName;
        logData[2] = {};
        logData[2].fieldName = "プロジェクトステータス";
        logData[2].beforeValue = "";
        logData[2].afterValue = (projectStatus == 0) ? "停止中" : "運用中";
        logData[3] = {};
        logData[3].fieldName = "メモ";
        logData[3].beforeValue = "";
        logData[3].afterValue = memo;
        logData[4] = {};
        logData[4].fieldName = "CSV出力形式";
        logData[4].beforeValue = "";
        logData[4].afterValue = projectCsvCharacterCode;
        try {
            // mysql connect
            mysql_con = await mysql.createConnection(writeDbConfig);
            // project code uniqueness check
            // get count query
            let count_sql = `SELECT COUNT(projectId) FROM Project WHERE projectCode = ?`;
            // get count
            let [query_count_result] = await mysql_con.execute(count_sql, [projectCode]);
            let data_count = Object.values(query_count_result[0]);
            console.log("same projectCode records count", data_count);
            // Check if the data already exists
            if (data_count > 0) {
                // Already exists, send error response
                console.log("Already exists domainURL");
                // failure log
                await createLog(context, 'プロジェクト', '作成', '失敗', '409', event.requestContext.identity.sourceIp, logAccountId, logData);
                return {
                    statusCode: 409,
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Headers": "*",
                    },
                    body: JSON.stringify({
                        message: "Duplicate entry"
                    }),
                };
            }
            // insert data query
            let sql_data = `INSERT INTO Project (projectCode, projectName, projectStatus,projectCsvCharacterCode, memo, createdAt, createdBy, updatedAt, updatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            // created date
            const createdAt = Math.floor(new Date().getTime() / 1000);
            console.log("sql_data:", sql_data);
            console.log("sql_param:", [
                projectCode,
                projectName,
                projectStatus,
                projectCsvCharacterCode,
                memo,
                createdAt,
                createdBy,
                createdAt,
                updatedBy,
            ]);
            const [query_result] = await mysql_con.execute(sql_data, [
                projectCode,
                projectName,
                projectStatus,
                projectCsvCharacterCode,
                memo,
                createdAt,
                createdBy,
                createdAt,
                updatedBy,
            ]);
            if (query_result.length === 0) {
                // failure log
                await createLog(context, 'プロジェクト', '作成', '失敗', '404', event.requestContext.identity.sourceIp, logAccountId, logData);
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
            console.log("response:", response);
            // success log
            await createLog(context, 'プロジェクト', '作成', '成功', '200', event.requestContext.identity.sourceIp, logAccountId, logData);
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
            await createLog(context, 'プロジェクト', '作成', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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
