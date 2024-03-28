
/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();

exports.handler = async (event) => {
    console.log(event);
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
        process.env.DBINFO = true
    }
    // Database info
    let readDbConfig = {
        host: process.env.DBREADENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET
    };
    console.log("Event data: ", event);
    // mysql connect
    let mysql_con = await mysql.createConnection(readDbConfig);

    if (event.pathParameters?.eventId != null) {
        let projectId = 0;
        let eventId = event.pathParameters.eventId;
        let jsonBody = event.queryStringParameters;
        if (jsonBody?.pid) {
            projectId = jsonBody.pid;
        } else {
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
            validProjectId = JSON.parse(event?.requestContext?.authorizer?.pid)
            // pidがない場合　もしくは　許可プロジェクトIDに含まれていない場合
            if (!projectId || validProjectId.indexOf(Number(projectId)) == -1) {
                // console.log("Unauthorized 1");
                return {
                    statusCode: 403,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': '*',
                    },
                    body: JSON.stringify("Unauthorized"),
                }
            }
        }
        let validEventId;
        if (event?.requestContext?.authorizer?.eid) {
            validEventId = JSON.parse(event?.requestContext?.authorizer?.eid)
            // eidがない場合　もしくは　許可イベントIDに含まれていない場合
            if (!eventId || validEventId.indexOf(Number(eventId)) == -1) {
                // console.log("Unauthorized 2_1 = ", event?.requestContext?.authorizer?.eid);
                // console.log("Unauthorized 2_2 = ", eventId);
                return {
                    statusCode: 403,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': '*',
                    },
                    body: JSON.stringify("Unauthorized"),
                }
            }
        }

        console.log("got query string params!")
        // Expand POST parameters 
        //  let jsonBody = JSON.parse(event.body);
        // let jsonBody = event.queryStringParameters;
        // let pagesVisited = (jsonBody.pagesVisited || jsonBody.pagesVisited == 0) ? jsonBody.pagesVisited : 0;
        // let itemsPerPage = (jsonBody.itemsPerPage || jsonBody.itemsPerPage == 0) ? jsonBody.itemsPerPage : 500;
        // Other search query ( roleId , accountName)
        let parameter = [];
        let searchFlag = false;
        let sql_count = "";
        let sql_data = "";
        let whereQuery = "";
        // if(jsonBody.categoryId || jsonBody.instituteName){
        // if(jsonBody.mappingDatetimeFrom || jsonBody.mappingDatetimeTo || jsonBody.categoryId || jsonBody.instituteName){
        // searchFlag = true;
        // if (jsonBody.mappingDatetimeFrom) {
        //     whereQuery += ` AND EventMapping.mappingDatetime >= ?`;
        //     console.log("Type of the data:",typeof(jsonBody.mappingDatetimeFrom));
        //     parameter.push(parseInt(jsonBody.mappingDatetimeFrom));
        // }
        // if (jsonBody.mappingDatetimeTo) {
        //     whereQuery += ` AND EventMapping.mappingDatetime <= ?`;
        //     console.log("Type of the data:",typeof(jsonBody.mappingDatetimeTo));
        //     parameter.push(parseInt(jsonBody.mappingDatetimeTo));
        // }
        //     if (jsonBody.categoryId) {
        //         whereQuery += ` AND EventMapping.categoryId = ?`;
        //         parameter.push(jsonBody.categoryId);
        //     }
        //     if (jsonBody.instituteName) {
        //         whereQuery += ` AND Institute.instituteName like ?`;
        //         parameter.push("%" + jsonBody.instituteName + "%");
        //     }
        // }
        parameter.push(eventId);
        let validInstituteId;
        if (event?.requestContext?.authorizer?.iid) {
            validInstituteId = JSON.parse(event?.requestContext?.authorizer?.iid)
        }
        if (validInstituteId) {
            let checkSQL = `SELECT COUNT(*) AS cnt FROM EventCategory INNER JOIN EventInstitute ON EventCategory.eventCategoryId = EventInstitute.eventCategoryId 
           WHERE EventCategory.eventId = ? AND EventInstitute.instituteId IN (?)`
            var [query_count] = await mysql_con.query(checkSQL, [eventId, validInstituteId]);
            if (query_count[0].cnt >= 1) {
                whereQuery += ` AND Institute.instituteId IN (?)`;
                parameter.push(validInstituteId);
            }
        }

        // console.log("validInstituteId", validInstituteId);
        // console.log("whereQuery", whereQuery);



        // get list sql
        sql_data = `SELECT 
           Event.eventId,
           Event.eventName,
           Event.eventStartDate,
           Event.eventEndDate,
           EventCategory.eventCategoryId,
           EventCategory.eventCategoryStartDate,
           EventCategory.eventCategoryEndDate,
           EventCategory.eventCategoryName,
           Category.categoryId,
           Category.categoryName,
           EventInstitute.eventInstituteId,
           EventInstitute.eventInstituteStartDate,
           EventInstitute.eventInstituteEndDate,
           EventInstitute.eventInstituteName,
           EventInstitute.eventInstituteSlotType,
           EventInstitute.eventInstituteItemType,
           EventInstitute.eventInstituteDentalFlag,
           Institute.instituteId,
           Institute.instituteName,
           EventMapping.mappingId,
           EventMapping.mappingDatetime,
           EventMapping.mappingStartDate,
           EventMapping.mappingEndDate,
           EventMapping.receptionDatetimeFrom,
           EventMapping.receptionDatetimeTo 
       FROM Event
           LEFT OUTER JOIN EventCategory ON Event.eventId = EventCategory.eventId
           LEFT OUTER JOIN Category ON EventCategory.categoryId = Category.categoryId
           LEFT OUTER JOIN EventInstitute ON EventCategory.eventCategoryId = EventInstitute.eventCategoryId
           LEFT OUTER JOIN Institute ON EventInstitute.instituteId = Institute.instituteId
           LEFT OUTER JOIN EventMapping ON EventInstitute.eventInstituteId = EventMapping.eventInstituteId
       WHERE Event.eventId = ? ${whereQuery}
       ORDER BY Event.eventId ASC, EventCategory.eventCategoryId ASC, EventInstitute.eventInstituteId ASC, EventMapping.mappingDatetime ASC`


        // console.log("institute data = ", sql_data);


        try {
            //
            // var [query_result1, query_fields1] = await mysql_con.query(sql_count, parameter);
            // parameter.push(Number(pagesVisited));
            // parameter.push(Number(itemsPerPage));
            // console.log("Query string params: ",parameter);    
            console.log("query:", sql_data);
            var [query_result2] = await mysql_con.query(sql_data, parameter);

            console.log('my checking -------------', query_result2)
            // 
            let eventList = [];
            let eventAddFlag = true;
            let categoryAddFlag = false;
            let instituteAddFlag = false;

            let lastEventCategoryId = 0;
            let lastEventInstituteId = 0;

            let tempEventCategoryId = 0;
            let tempEventInstituteId = 0;

            let id = 1;

            let parentEventId = 0;
            let parentCategoryId = 0;
            let parentInstituteId = 0;

            if (query_result2.length >= 1) {
                for (let i = 0; i < query_result2.length; i++) {
                    let row = query_result2[i];
                    console.log(row);
                    let rowObject;
                    // 🔸🔸🔸 type eventがない場合作成する
                    for (let j = 0; j < eventList.length; j++) {
                        if (eventList[j]?.type == "event") {
                            eventAddFlag = false;
                            break;
                        }
                    }
                    // trueだった場合イベント配列の作成
                    if (eventAddFlag) {
                        rowObject = {
                            "id": id,
                            "title": row.eventName,
                            "start": row.eventStartDate * 1000,
                            "end": row.eventEndDate * 1000,
                            "receptionDatetimeFrom": row.eventStartDate * 1000,
                            "receptionDatetimeTo": row.eventEndDate * 1000,
                            "type": "event",
                            "taskColor": "#145c8f",
                            "eventId": row.eventId
                        };
                        parentEventId = id;
                        id++;
                        eventList.push(rowObject);
                    }
                    // 🔸🔸🔸 type カテゴリーがない場合作成する
                    if (lastEventCategoryId == 0) {
                        categoryAddFlag = true;
                        lastEventCategoryId = row.eventCategoryId;
                    }
                    else {
                        tempEventCategoryId = row.eventCategoryId;
                        console.log("tempEventCategoryId " + i + " = " + tempEventCategoryId);
                        console.log("lastEcentCategoryId " + i + " = " + lastEventCategoryId);
                        if (tempEventCategoryId == lastEventCategoryId) {
                            categoryAddFlag = false;
                        }
                        else {
                            lastEventCategoryId = row.eventCategoryId;
                            categoryAddFlag = true;
                        }
                    }
                    console.log(" ------------------ ");
                    // console.log("lastEventCategoryId = " + lastEventCategoryId);
                    // trueだった場合カテゴリー配列の作成
                    if (categoryAddFlag) {
                        if (row.eventCategoryId) {
                            rowObject = {
                                "id": id,
                                "parentId": parentEventId,
                                "title": (row.eventCategoryName) ? row.eventCategoryName : row.categoryName,
                                "start": row.eventCategoryStartDate * 1000,
                                "end": row.eventCategoryEndDate * 1000,
                                "receptionDatetimeFrom": row.eventCategoryStartDate * 1000,
                                "receptionDatetimeTo": row.eventCategoryEndDate * 1000,
                                "type": "category",
                                "taskColor": "#e4efe9",
                                "categoryId": row.categoryId,
                                "eventCategoryId": row.eventCategoryId,
                                "eventId": row.eventId
                            };
                            parentCategoryId = id;
                            id++;
                            eventList.push(rowObject);
                        }
                    }
                    // 🔸🔸🔸 type 施設がない場合作成する
                    if (lastEventInstituteId == 0) {
                        instituteAddFlag = true;
                        lastEventInstituteId = row.eventInstituteId;
                    }
                    else {
                        // for (let j = 0; j < eventList.length; j++) {
                        //     if (eventList[j]?.type == "category") {
                        //         tempEventInstituteId = eventList[j].instituteId;
                        //     }
                        // }
                        tempEventInstituteId = row.eventInstituteId;
                        console.log("tempEventInstituteId " + i + " = " + tempEventInstituteId);
                        console.log("lastEventInstituteId " + i + " = " + lastEventInstituteId);
                        if (tempEventInstituteId == lastEventInstituteId) {
                            instituteAddFlag = false;
                        }
                        else {
                            lastEventInstituteId = row.eventInstituteId;
                            instituteAddFlag = true;
                        }
                    }
                    console.log(" ------------------ ");
                    // trueだった場合施設配列の作成
                    if (instituteAddFlag) {
                        if (row.eventInstituteId) {
                            rowObject = {
                                "id": id,
                                "parentId": parentCategoryId,
                                "title": (row.eventInstituteName) ? row.eventInstituteName : row.instituteName,
                                "start": row.eventInstituteStartDate * 1000,
                                "end": row.eventInstituteEndDate * 1000,
                                "receptionDatetimeFrom": row.eventInstituteStartDate * 1000,
                                "receptionDatetimeTo": row.eventInstituteEndDate * 1000,
                                "type": "institute",
                                "taskColor": "#03AF7A",
                                "instituteId": row.instituteId,
                                "eventCategoryId": row.eventCategoryId,
                                "eventInstituteId": row.eventInstituteId,
                                "categoryType": row.eventInstituteItemType,
                                "eventId": row.eventId
                            };
                            parentInstituteId = id;
                            id++;
                            eventList.push(rowObject);
                        }
                    }
                    if (row.mappingId) {
                        // 🔸🔸🔸 type 実施日がない場合作成する
                        rowObject = {
                            "id": id,
                            "parentId": parentInstituteId,
                            "title": "実施日",
                            "start": row.mappingDatetime * 1000,
                            "end": row.mappingDatetime * 1000,
                            "type": "date",
                            "taskColor": "#03AF7A",
                            "mappingId": row.mappingId,
                            "mappingStartDate": row.mappingStartDate * 1000,
                            "mappingEndDate": row.mappingEndDate * 1000,
                            "receptionDatetimeFrom": row.receptionDatetimeFrom * 1000,
                            "receptionDatetimeTo": row.receptionDatetimeTo * 1000,
                            "eventId": row.eventId,
                            "eventCategoryId": row.eventCategoryId,
                            "eventInstituteId": row.eventInstituteId,
                            "eventBusId": row.eventBusId
                        };
                        id++;
                        if (row.eventInstituteSlotType == 2) {
                            rowObject.bus = 1;
                            // rowObject.eventBusId = row.eventBusId;
                        }
                        eventList.push(rowObject);
                    }
                }
            }
            let response = {
                // count: query_result1[0].count,
                records: eventList
            }
            // console.log(response);
            return {
                statusCode: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(response),
            }
        } catch (error) {
            console.log(error)
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(error),
            }
        }
    }
    else {
        console.log("invalid parameter");
        return {
            statusCode: 400,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "*",
            },
            body: JSON.stringify({ "message": "invalid parameter" }),
        };
    }
}
