/**
* @type {import('@types/aws-lambda').APIGatewayProxyHandler}
*/
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();

/**
* ManagerAppEditorRead.
* 
* @param {*} event 
* @returns {json} response.
*/

function getBlocksFromFreePage(pages){
    var blocks_of_page = [];
    // Formatting free pages to include blocks as an array
    pages.forEach((element) => {
        // Push the block to the block list of each page
        if (typeof blocks_of_page[element.appPageId] !== 'undefined'){
            blocks_of_page[element.appPageId].push({
                "appPageBlockId": element.appPageBlockId,
                "appPageBlockOrderNo": element.appPageBlockOrderNo,
                "blockPageId": element.blockPageId,
            })
        }
        // if the page doesnt have any block, create array of blocks and push it
        else{
            blocks_of_page[element.appPageId] = [{
                "appPageBlockId": element.appPageBlockId,
                "appPageBlockOrderNo": element.appPageBlockOrderNo,
                "blockPageId": element.blockPageId,
            }]
        }
    })

    return blocks_of_page;
} 

function getBlocksFromCommonPage(pages){
    var blocks_of_page = [];
    // Formatting free pages to include blocks as an array
    pages.forEach((element) => {
        // Push the block to the block list of each page
        if (typeof blocks_of_page[element.appCommonPageId] !== 'undefined'){
            blocks_of_page[element.appCommonPageId].push({
                "appPageBlockId": element.appPageBlockId,
                "appPageBlockOrderNo": element.appPageBlockOrderNo,
                "blockPageId": element.blockPageId,
            })
        }
        // if the page doesnt have any block, create array of blocks and push it
        else{
            blocks_of_page[element.appCommonPageId] = [{
                "appPageBlockId": element.appPageBlockId,
                "appPageBlockOrderNo": element.appPageBlockOrderNo,
                "blockPageId": element.blockPageId,
            }]
        }
    })

    return blocks_of_page;
}  

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
    if (event.pathParameters && event.pathParameters?.appId) {
        // Expand GET parameters
        let jsonBody = event.queryStringParameters;
        console.log("event.queryStringParameters:", jsonBody);

        let appId = event.pathParameters.appId;
        let parameter = [];
        // get one record sql
        const free_pages_sql_data = `SELECT DISTINCT 
                                        appPageId, 
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
                                        appPageBlock AS blocks,
                                        appPageLoadingFlag,
                                        appPageLoadingStopFlag,
                                        memo,  
                                        updatedBy
                                    FROM AppPage
                                    WHERE appId = ? AND appPageTypeFlag = 0
                                    ORDER BY appPageOrderNo;`;
        
        const common_pages_sql_data = `SELECT DISTINCT 
                                        appPageId AS appCommonPageId, 
                                        appPageOrderNo AS appCommonPageSubId,
                                        appId,
                                        appPageManagerName AS appCommonPageManagerName, 
                                        appPageURLName AS appCommonPageURLName, 
                                        appPageTitle AS appCommonPageTitle, 
                                        appPageDescription AS appCommonPageDescription, 
                                        appPageCustomClass AS appCommonPageCustomClass,
                                        updatedBy,
                                        appPageBlock AS blocks
                                    FROM AppPage
                                    WHERE appId = ? AND appPageTypeFlag = 1
                                    ORDER BY appPageId;`;

        // const common_pages_sql_data = `SELECT *
        // FROM AppCommonPage
        // WHERE AppCommonPage.appId = ? 
        // ORDER BY appCommonPageSubId;`

        const settings_sql_data = `SELECT *
        FROM AppSetting
        WHERE AppSetting.appId = ?;`

        parameter.push(Number(appId));

        console.log("free_pages_sql_data:", free_pages_sql_data);
        console.log("common_pages_sql_data:", common_pages_sql_data);
        console.log("settings_sql_data:", common_pages_sql_data);
        console.log("query params:", parameter);

        let mysql_con;
        try {
            // mysql connect
            mysql_con = await mysql.createConnection(readDbConfig);
            
            let appSql = `SELECT appName, projectId, Domain.domainURL, appDesignBlocks, appDesignHistories FROM App INNER JOIN Event ON Event.eventId = App.eventId LEFT OUTER JOIN Domain ON App.appDomainId = Domain.domainId WHERE App.appId = ?`
                            
            var [app_query_result, app_query_fields] = await mysql_con.query(appSql, parameter);
            var [free_pages_query_result, free_query_fields] = await mysql_con.query(free_pages_sql_data, parameter);
            var [common_pages_query_result, common_query_fields] = await mysql_con.query(common_pages_sql_data, parameter);
            var [settings_query_result, settings_query_fields] = await mysql_con.query(settings_sql_data, parameter);

            if (free_pages_query_result && common_pages_query_result && settings_query_result) {

                // var blocks_of_page = getBlocksFromFreePage(free_pages_query_result);
                // var blocks_of_common_page = getBlocksFromCommonPage(common_pages_query_result);

                // console.log("blocks_of_page");
                // console.log(blocks_of_page);

                // var uniqueFreePages = {};
                // var uniqueCommonPages = {};

                free_pages_query_result.forEach((element) => {
                    if (!element.blocks) element.blocks = [];
                    else{
                        element.blocks = [...element.blocks.records]
                    }
                })
                common_pages_query_result.forEach((element) => {
                    if (!element.blocks) element.blocks = [];
                    else{
                        element.blocks = [...element.blocks.records]
                    }
                })
                app_query_result[0].appId = appId;
                // get response
                let response = {
                    records: {
                        "freePages": free_pages_query_result,
                        "commonPages": common_pages_query_result,
                        "settings": settings_query_result[0]?.appSettingQuery,
                        "blocks": app_query_result[0].appDesignBlocks,
                        "histories": app_query_result[0].appDesignHistories,
                    },
                    "appData": app_query_result[0]
                }
                console.log("query response:", response);
                return {
                    statusCode: 200,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': '*',
                    },
                    body: JSON.stringify(response),
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
                    body: JSON.stringify(response),
                }
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
        let response = {
            message: "Invalid parameter."
        };
        return {
            statusCode: 400,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify(response),
        }
    }
};