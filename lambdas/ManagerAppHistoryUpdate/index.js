/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();

/**
 * ManagerAppHistoryUpdate.
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

    const {
        appHistoriesId,
        updatedBy
    } = JSON.parse(event.body);

    if (event.pathParameters && event.pathParameters?.appId) {
        let appId = event.pathParameters.appId;
        let parameter = [];
        // get one record sql
        const sql_historiesData = `SELECT appHistoriesJsonData FROM AppHistories WHERE appHistoriesId = ?`
        parameter.push(appHistoriesId);

        console.log("sql_historiesData:", sql_historiesData);
        console.log("query params:", parameter);

        // update blocks and histories if exists
        const sql_for_blocks_histories = `UPDATE App SET appDesignBlocks = ?, appDesignHistories = ? WHERE appId = ?`

        console.log("sql_for_blocks_histories:", sql_for_blocks_histories);

        const delete_sql = `DELETE FROM AppPage WHERE appId = ?`;
        console.log("delete_sql:", delete_sql);

        const new_appPage_sql = `INSERT INTO AppPage ( 
            appPageId,
            appId,
            appPageOrderNo, 
            appPageManagerName, 
            appPageURLName, 
            appPageTitle, 
            appPageDescription,
            appPageRootFlag,
            appPageStepType,
            appPageStepValue,
            appPageAuthFlag,
            appPageTransitionSource,
            appPageCustomClass,
            appPageBlock,
            appPageLoadingFlag,
            appPageLoadingStopFlag,
            memo,
            createdAt,
            createdBy,
            updatedAt,
            updatedBy
            ) 
        VALUES ?`;

        console.log("new_appPage_sql:", new_appPage_sql);

        const new_commonPage_sql = `INSERT INTO AppPage ( 
            appPageId,
            appId,
            appPageOrderNo, 
            appPageManagerName, 
            appPageURLName, 
            appPageTitle, 
            appPageDescription,
            appPageCustomClass,
            appPageBlock,
            appPageLoadingFlag,
            appPageLoadingStopFlag,
            appPageTypeFlag,
            createdAt,
            createdBy,
            updatedAt,
            updatedBy
            ) 
        VALUES ?`;

        console.log("new_commonPage_sql:", new_commonPage_sql);

        // update pageBlock if exists
        const sql_for_settingQuery = `UPDATE AppSetting SET appSettingQuery = ? WHERE appId = ?`

        console.log("sql_for_settingQuery:", sql_for_settingQuery);

        let mysql_con;
        try {
            // mysql connect
            mysql_con = await mysql.createConnection(readDbConfig);
            await mysql_con.beginTransaction();
            let [appHistories_query_result1] = await mysql_con.query(sql_historiesData, parameter);
            if (appHistories_query_result1 && appHistories_query_result1[0]) {
                let records = appHistories_query_result1[0].appHistoriesJsonData
                console.log("records:", records);

                console.log("AppHistories.blocks:", records.blocks);
                console.log("AppHistories.histories:", records.histories);
                // upadte App 
                await mysql_con.query(sql_for_blocks_histories, [JSON.stringify(records.blocks), JSON.stringify(records.histories), appId]);
                
                // delete AppPage
                await mysql_con.query(delete_sql, [appId]);

                const updatedAt = Math.floor(new Date().getTime() / 1000);

                let newFreePageValueArr = [];
                records.freePages.map((page) => {
                    let values = [
                        page.appPageId,
                        appId,
                        page.appPageOrderNo,
                        page.appPageManagerName,
                        page.appPageURLName,
                        page.appPageTitle,
                        page.appPageDescription,
                        page.appPageRootFlag,
                        page.appPageStepType,
                        page.appPageStepValue,
                        page.appPageAuthFlag,
                        page.appPageTransitionSource? JSON.stringify(page.appPageTransitionSource) : page.appPageTransitionSource,
                        page.appPageCustomClass,
                        page.blocks? JSON.stringify(page.blocks) : page.blocks,
                        page.appPageLoadingFlag,
                        page.appPageLoadingStopFlag? JSON.stringify(page.appPageLoadingStopFlag) : page.appPageLoadingStopFlag,
                        page.memo,
                        updatedAt,
                        updatedBy,
                        updatedAt,
                        updatedBy
                    ];
                    newFreePageValueArr.push(values);
                })

                // insert AppPage FreePage
                if (newFreePageValueArr.length > 0) {
                    console.log("newFreePageValueArr:", newFreePageValueArr);
                    await mysql_con.query(new_appPage_sql, [newFreePageValueArr]);
                }

                let newAppCommonPageValueArr = [];
                records.commonPages.map((page) => {
                    let values = [
                        page.appCommonPageId,
                        appId,
                        page.appCommonPageSubId,
                        page.appCommonPageManagerName,
                        page.appCommonPageURLName,
                        page.appCommonPageTitle,
                        page.appCommonPageDescription,
                        page.appCommonPageCustomClass,
                        page.blocks? JSON.stringify(page.blocks) : page.blocks,
                        page.appPageLoadingFlag,
                        page.appPageLoadingStopFlag? JSON.stringify(page.appPageLoadingStopFlag) : page.appPageLoadingStopFlag,
                        1,
                        updatedAt,
                        updatedBy,
                        updatedAt,
                        updatedBy
                    ];

                    newAppCommonPageValueArr.push(values);
                })

                // insert AppPage CommonPage
                if (newAppCommonPageValueArr.length > 0) {
                    console.log("newAppCommonPageValueArr:", newAppCommonPageValueArr);
                    await mysql_con.query(new_commonPage_sql, [newAppCommonPageValueArr]);
                }
                
                console.log("AppHistories.settings:", records.settings);
                // update AppSetting
                await mysql_con.query(sql_for_settingQuery, [JSON.stringify(records.settings), appId]);
                
                await mysql_con.commit();
                // get response
                let response = "Success";
                console.log("query response:", response);
                return {
                    statusCode: 200,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': '*',
                    },
                    body: response,
                }
            } else {
                let response = {
                    message: "no data"
                }
                return {
                    statusCode: 200,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': '*',
                    },
                    body: response,
                }
            }
        } catch (error) {
            await mysql_con.rollback();
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
    } else {
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
}