/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk');
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerEventDeleteBatch.
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
    const writeDbConfig = {
        host: process.env.DBWRITEENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET
    };

    const projectId = event.projectId;
    const eventId = Number(event.eventId);

    let mysql_con;
    try {
        mysql_con = await mysql.createConnection(writeDbConfig);
        await mysql_con.beginTransaction();

        let eventCategoryIdArray = [];
        let eventInstituteIdArray = [];
        let mappingIdArray = [];

        // get event category data
        let param_event_category = [];
        const sql_event_category = `SELECT eventCategoryId FROM EventCategory WHERE eventId = ?`;
        param_event_category.push(eventId);
        let [query_result2] = await mysql_con.query(sql_event_category, param_event_category);
        // console.log("query_result2.length", query_result2.length);
        if (query_result2.length !== 0) {
            // get event category ids
            eventCategoryIdArray = query_result2.map(obj => obj.eventCategoryId);
            // get event institute data
            const sql_event_institute = `SELECT eventInstituteId FROM EventInstitute WHERE eventCategoryId IN (?)`;
            let [query_result3] = await mysql_con.query(sql_event_institute, [eventCategoryIdArray]);
            // console.log("query_result3.length", query_result3.length);
            if (query_result3.length !== 0) {
                // get event institute ids
                eventInstituteIdArray = query_result3.map(obj => obj.eventInstituteId);
                // console.log("=========eventInstituteIdArray", eventInstituteIdArray)
                // get event mapping data
                const sql_event_mapping = `SELECT mappingId FROM EventMapping WHERE eventInstituteId IN (?)`;
                let [query_result4] = await mysql_con.query(sql_event_mapping, [eventInstituteIdArray]);
                // console.log("query_result4.length", query_result4.length);
                if (query_result4.length !== 0) {
                    // get event mapping ids
                    mappingIdArray = query_result4.map(obj => obj.mappingId);
                    // console.log("=========mappingIdArray", mappingIdArray)
                    // get event slot data
                    const sql_event_slot = `SELECT slotId, mappingId, itemId, itemSubId, counselorId, counselorSubId FROM EventSlot WHERE mappingId IN (?)`;
                    let [query_result5] = await mysql_con.query(sql_event_slot, [mappingIdArray]);
                    // console.log("query_result5.length", query_result5.length);
                    if (query_result5.length !== 0) {
                        for (let index = 0; index < query_result5.length; index++) {
                            const element = query_result5[index];
                            // get event sub item data and get event sub counselor data
                            // make where condition
                            let conditionEventSubItemArray = [];
                            let conditionEventSubCounselorArray = [];
                            if (element.mappingId !== null && element.itemId !== null && element.itemSubId !== null) {
                                conditionEventSubItemArray.push(`(mappingId = ${element.mappingId} AND itemId = ${element.itemId} AND itemSubId = ${element.itemSubId})`);
                            }
                            // counselor type
                            else if (element.mappingId !== null && element.counselorId !== null && element.counselorSubId !== null) {
                                conditionEventSubCounselorArray.push(`(mappingId = ${element.mappingId} AND counselorId = ${element.counselorId} AND counselorSubId = ${element.counselorSubId})`);
                            }

                            if (conditionEventSubItemArray.length !== 0) {
                                // console.log("=========conditionEventSubItemArray", conditionEventSubItemArray)
                                // get event sub item data
                                const conditionEventSubItemStr = conditionEventSubItemArray.join('OR');
                                // console.log("=========conditionEventSubItemStr", conditionEventSubItemStr)
                                const sql_event_sub_item = `SELECT eventSubItemId FROM EventSubItem WHERE ${conditionEventSubItemStr}`;
                                let [query_result6] = await mysql_con.query(sql_event_sub_item);
                                // console.log("query_result6.length", query_result6.length);
                                if (query_result6.length !== 0) {
                                    // get event sub item ids
                                    const eventSubItemIdArray = query_result6.map(obj => obj.eventSubItemId);
                                    // console.log("=========eventSubItemIdArray", eventSubItemIdArray)
                                    const sql_event_sub_item_del = `DELETE FROM EventSubItem WHERE eventSubItemId IN (?)`;
                                    await mysql_con.query(sql_event_sub_item_del, [eventSubItemIdArray]);
                                }
                            }

                            if (conditionEventSubCounselorArray.length !== 0) {
                                // get event sub counselor data
                                const conditionEventSubCounselorStr = conditionEventSubCounselorArray.join('OR');
                                const sql_event_sub_counselor = `SELECT eventSubCounselorId FROM EventSubCounselor WHERE ${conditionEventSubCounselorStr}`;
                                let [query_result7] = await mysql_con.query(sql_event_sub_counselor);
                                // console.log("query_result7.length", query_result7.length);
                                if (query_result7.length !== 0) {
                                    // get event sub counselor ids
                                    const eventSubCounselorIdArray = query_result7.map(obj => obj.eventSubCounselorId);
                                    // console.log("=========eventSubCounselorIdArray", eventSubCounselorIdArray)
                                    const sql_event_sub_counselor_del = `DELETE FROM EventSubCounselor WHERE eventSubCounselorId IN (?)`;
                                    await mysql_con.query(sql_event_sub_counselor_del, eventSubCounselorIdArray);
                                }
                            }
                        }

                        // get event slot ids
                        const slotIdArray = query_result5.map(obj => obj.slotId);
                        // console.log("=========slotIdArray", slotIdArray)
                        const sql_event_slot_del = `DELETE FROM EventSlot WHERE slotId IN (?)`;
                        await mysql_con.query(sql_event_slot_del, [slotIdArray]);
                    }

                    // get event bus data
                    const sql_event_bus = `SELECT eventBusId FROM EventBus WHERE mappingId IN (?)`;
                    let [query_result8] = await mysql_con.query(sql_event_bus, [mappingIdArray]);
                    // console.log("query_result8.length", query_result8.length);
                    if (query_result8.length !== 0) {
                        // get event bus ids
                        const eventBusIdArray = query_result8.map(obj => obj.eventBusId);
                        // console.log("=========eventBusIdArray", eventBusIdArray)
                        const sql_event_bus_del = `DELETE FROM EventBus WHERE eventBusId IN (?)`;
                        await mysql_con.query(sql_event_bus_del, [eventBusIdArray]);
                    }

                    // get event mapping ids
                    const sql_event_mapping_del = `DELETE FROM EventMapping WHERE mappingId IN (?)`;
                    // delete event mapping
                    await mysql_con.query(sql_event_mapping_del, [mappingIdArray]);
                }
                // get event institute ids
                const sql_event_institute_del = `DELETE FROM EventInstitute WHERE eventInstituteId IN (?)`;
                // delete event institute
                await mysql_con.query(sql_event_institute_del, [eventInstituteIdArray]);
            }

            // delete event category
            const sql_event_category_del = `DELETE FROM EventCategory WHERE eventId = ?`;
            await mysql_con.query(sql_event_category_del, [eventId]);

            // delete email template
            const sql_email_template_del = `DELETE FROM EmailTemplate WHERE eventId = ?`;
            await mysql_con.query(sql_email_template_del, [eventId]);

            // delete sms template
            const sql_sms_template_del = `DELETE FROM SMSTemplate WHERE eventId = ?`;
            await mysql_con.query(sql_sms_template_del, [eventId]);
        }

        console.log("==================== event delete finished");

        await mysql_con.commit();
        // success log
        // await createLog(context, 'イベント', '削除', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify({ "message": "delete success" }),
        };
    } catch (error) {
        await mysql_con.rollback();
        console.log(error);
        // failure log
        // await createLog(context, 'イベント', '削除', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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