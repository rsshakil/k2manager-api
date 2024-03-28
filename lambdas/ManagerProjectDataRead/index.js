/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();

/**
 * ManagerCategoryRead.
 * 
 * @param {*} event 
 * @returns {json} response
 */
exports.handler = async (event) => {
    console.log("Event data:", event);
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
    const readDbConfig = {
        host: process.env.DBREADENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET
    };
    // Get one record by primary key
    if (event.pathParameters && event.pathParameters?.projectId) {
    // if (true) {
        // Expand GET parameters
        let projectId = event.pathParameters?.projectId;
console.log("event.body", event);
        // let jsonBody = JSON.parse(event);
        // let projectId = event.projectId;
        let validProjectId;
        if (event?.requestContext?.authorizer?.pid) {
            validProjectId = JSON.parse(event?.requestContext?.authorizer?.pid)
            // pidがない場合　もしくは　許可プロジェクトIDに含まれていない場合
            if (!projectId || validProjectId.indexOf(Number(projectId)) == -1) {
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

        let parameter = [];
        parameter.push(Number(projectId));
        // category
        const categorySqlData = `SELECT 
            Category.categoryId,
            EventCategory.eventCategoryId AS id,
            Category.categoryName AS value,
            Category.categoryManageName,
            App.appId
        FROM Category 
        INNER JOIN EventCategory ON Category.categoryId = EventCategory.categoryId
        INNER JOIN Event ON EventCategory.eventId = Event.eventId
        LEFT OUTER JOIN App ON Event.eventId = App.eventId
        WHERE App.appId IS NOT NULL AND Category.projectId = ? ORDER BY App.appId`
        // institute
        const instituteSqlData = `SELECT 
            Institute.instituteId,
            EventInstitute.eventInstituteId AS id,
            Institute.instituteName AS value,
            Institute.instituteManageName,
            App.appId
        FROM Institute 
        INNER JOIN EventInstitute ON Institute.instituteId = EventInstitute.instituteId
        INNER JOIN EventCategory ON EventInstitute.eventCategoryId = EventCategory.eventCategoryId
        INNER JOIN Event ON EventCategory.eventId = Event.eventId
        LEFT OUTER JOIN App ON Event.eventId = App.eventId
        WHERE App.appId IS NOT NULL AND Institute.projectId = ? ORDER BY App.appId`
        // item
        const itemSqlData = `SELECT DISTINCT
            Item.itemId AS id,
            Item.itemName AS value,
            Item.itemManageName,
            App.appId
        FROM Item 
        INNER JOIN EventSlot ON Item.itemId = EventSlot.itemId AND EventSlot.itemSubId = 0
        INNER JOIN EventMapping ON EventSlot.mappingId = EventMapping.mappingId
        INNER JOIN EventInstitute ON EventMapping.eventInstituteId = EventInstitute.eventInstituteId
        INNER JOIN EventCategory ON EventInstitute.eventCategoryId = EventCategory.eventCategoryId
        INNER JOIN Event ON EventCategory.eventId = Event.eventId
        INNER JOIN App ON Event.eventId = App.eventId
        WHERE App.appId IS NOT NULL AND Item.projectId = ? ORDER BY App.appId`
        // counselor
        const counselorSqlData = `SELECT DISTINCT
            Counselor.counselorId AS id,
            Counselor.counselorName AS value,
            Counselor.counselorManageName,
            App.appId
        FROM Counselor 
        INNER JOIN EventSlot ON Counselor.counselorId = EventSlot.counselorId AND EventSlot.counselorSubId = 0
        INNER JOIN EventMapping ON EventSlot.mappingId = EventMapping.mappingId
        INNER JOIN EventInstitute ON EventMapping.eventInstituteId = EventInstitute.eventInstituteId
        INNER JOIN EventCategory ON EventInstitute.eventCategoryId = EventCategory.eventCategoryId
        INNER JOIN Event ON EventCategory.eventId = Event.eventId
        INNER JOIN App ON Event.eventId = App.eventId
        WHERE App.appId IS NOT NULL AND Counselor.projectId = ? ORDER BY App.appId`;
        // busroute
        const busRouteSqlData = `SELECT DISTINCT
            BusRoute.busRouteId,
            EventBus.eventBusId AS id,
            BusRoute.busRouteName AS value,
            BusRoute.busRouteManageName,
            App.appId
        FROM BusRoute 
        INNER JOIN BusWay ON BusRoute.busRouteId = BusWay.busRouteId
        INNER JOIN BusRouteStop ON BusRoute.busRouteId = BusRouteStop.busRouteId
        INNER JOIN BusStop ON BusRouteStop.busStopId = BusStop.busStopId
        INNER JOIN BusTimeTable ON BusWay.busWayId = BusTimeTable.busWayId AND BusStop.busStopId = BusTimeTable.busStopId
        INNER JOIN EventBus ON BusWay.busWayId = EventBus.busWayId
        INNER JOIN EventMapping ON EventBus.mappingId = EventMapping.mappingId
        INNER JOIN EventInstitute ON EventMapping.eventInstituteId = EventInstitute.eventInstituteId
        INNER JOIN EventCategory ON EventInstitute.eventCategoryId = EventCategory.eventCategoryId
        INNER JOIN Event ON EventCategory.eventId = Event.eventId
        INNER JOIN App ON Event.eventId = App.eventId
        WHERE App.appId IS NOT NULL AND BusRoute.projectId = ? ORDER BY App.appId`;
        // console.log("sql_data:", sql_data);
        // console.log("query params:", parameter);
        let mysql_con;
        try {
            // mysql connect
            mysql_con = await mysql.createConnection(readDbConfig);
            let [queryResult1] = await mysql_con.query(categorySqlData, parameter);
            let [queryResult2] = await mysql_con.query(instituteSqlData, parameter);
            let [queryResult3] = await mysql_con.query(itemSqlData, parameter);
            let [queryResult4] = await mysql_con.query(counselorSqlData, parameter);
            let [queryResult5] = await mysql_con.query(busRouteSqlData, parameter);
            // category成形
            let appId = 0;
            let categoryForApp = {};
            for (let i = 0; i < queryResult1.length; i++) {
                let row = queryResult1[i];
                if (appId != row.appId) {
                    appId = row.appId
                    let key = 'appId_' + appId
                    categoryForApp[key] = []
                    categoryForApp[key].push(row);
                }
                else {
                    let key = 'appId_' + appId
                    categoryForApp[key].push(row);
                }
            }
            appId = 0;
            let instituteForApp = {};
            for (let i = 0; i < queryResult2.length; i++) {
                let row = queryResult2[i];
                if (appId != row.appId) {
                    appId = row.appId
                    let key = 'appId_' + appId
                    instituteForApp[key] = []
                    instituteForApp[key].push(row);
                }
                else {
                    let key = 'appId_' + appId
                    instituteForApp[key].push(row);
                }
            }
            appId = 0;
            let itemForApp = {};
            for (let i = 0; i < queryResult3.length; i++) {
                let row = queryResult3[i];
                if (appId != row.appId) {
                    appId = row.appId
                    let key = 'appId_' + appId
                    itemForApp[key] = []
                    itemForApp[key].push(row);
                }
                else {
                    let key = 'appId_' + appId
                    itemForApp[key].push(row);
                }
            }
            appId = 0;
            let counselorForApp = {};
            for (let i = 0; i < queryResult4.length; i++) {
                let row = queryResult4[i];
                if (appId != row.appId) {
                    appId = row.appId
                    let key = 'appId_' + appId
                    counselorForApp[key] = []
                    counselorForApp[key].push(row);
                }
                else {
                    let key = 'appId_' + appId
                    counselorForApp[key].push(row);
                }
            }
            appId = 0;
            let busRouteForApp = {};
            for (let i = 0; i < queryResult5.length; i++) {
                let row = queryResult5[i];
                if (appId != row.appId) {
                    appId = row.appId
                    let key = 'appId_' + appId
                    busRouteForApp[key] = []
                    busRouteForApp[key].push(row);
                }
                else {
                    let key = 'appId_' + appId
                    busRouteForApp[key].push(row);
                }
            }
// console.log("busRouteForApp", busRouteForApp);
            // get response
            let response = {
                category: categoryForApp,
                institute: instituteForApp,
                item: itemForApp,
                counselor: counselorForApp,
                busRoute: busRouteForApp,
            }
            console.log("query response1:", response);
            console.log("query response2:", JSON.stringify(response));
            return {
                statusCode: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(response),
            }
        } catch (error) {
            console.log("error:", error)
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(error),
            }
        } finally {
            if (mysql_con) await mysql_con.close();
        }
    }
    else {
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
};