/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerEventBusUpdate.
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
        mappingId,
        busData,
        updatedBy
    } = JSON.parse(event.body);
    console.log("busData", busData);


    logAccountId = updatedBy;
    let mysql_con;
    try {
        // mysql connect
        mysql_con = await mysql.createConnection(writeDbConfig);
        await mysql_con.beginTransaction();

        // beforeDataの作成
        let beforeSql = `SELECT eventBusId, busReservationCount, busTime, busWayId FROM EventBus WHERE mappingId = ?`;
        let [beforeResult] = await mysql_con.execute(beforeSql, [mappingId]);

        let busWayIds = busData.map(item => item.busWayId);
        if (busWayIds && busWayIds.length === 0) {
            // バス路線が指定されていない場合は全て削除
            const sql_delete = `DELETE FROM EventBus WHERE mappingId = ?`;
            await mysql_con.query(sql_delete, [mappingId]);
            await mysql_con.commit();
        }
        else {
            const sql_delete = `DELETE FROM EventBus WHERE mappingId = ? AND busWayId NOT IN (?)`;
            let del_parameter = [mappingId, busWayIds];
            await mysql_con.query(sql_delete, del_parameter);

            for (let i = 0; i < busData.length; i++) {
                const sql_data_select = `SELECT * FROM EventBus WHERE mappingId = ? AND busWayId = ?`;
                let parameter = [mappingId, busData[i].busWayId];
                let [query_result_select] = await mysql_con.query(sql_data_select, parameter);
                console.log('query_result_select', query_result_select);
                if (query_result_select && query_result_select[0]) {
                    let sql_data_update = `UPDATE EventBus
                        SET
                            mappingId = ?,
                            busTime = ?,
                            busWayId = ?
                        WHERE mappingId = ? AND busWayId = ?`;

                    let sql_param_update = [
                        mappingId,
                        busData[i].busTime,
                        busData[i].busWayId,
                        mappingId,
                        busData[i].busWayId
                    ];
                    console.log("sql_data: for update", sql_data_update);
                    console.log("sql_param: for update", sql_param_update);

                    let [query_result_update] = await mysql_con.query(sql_data_update, sql_param_update);
                    console.log('query_result for update', query_result_update);
                }
                // No data found for update that's why make data
                else {
                    let sql_data = `INSERT INTO EventBus (
                            mappingId,
                            busTime,
                            busWayId
                        ) VALUES (?, ?, ?)`;

                    let sql_param = [
                        mappingId,
                        busData[i].busTime,
                        busData[i].busWayId
                    ];
                    console.log("sql_data: for insert", sql_data);
                    console.log("sql_param: for insert", sql_param);

                    let [query_result] = await mysql_con.query(sql_data, sql_param);
                    console.log('query_result for insert', query_result);
                }
            }

            await mysql_con.commit();
        }
        // afterDataの作成
        let afterSql = `SELECT eventBusId, busReservationCount, busTime, busWayId FROM EventBus WHERE mappingId = ?`;
        let [afterResult] = await mysql_con.execute(afterSql, [mappingId]);

        // ログ書き込み
        logData[0] = {};
        logData[0].fieldName = "イベントマッピングID";
        logData[0].beforeValue = mappingId;
        logData[0].afterValue = mappingId;
        logData[1] = {};
        logData[1].fieldName = "イベントバスデータ";
        logData[1].beforeValue = beforeResult;
        logData[1].afterValue = afterResult;

        // success log
        await createLog(context, 'イベントバス', '更新', '成功', '200', event.requestContext.identity.sourceIp, logAccountId, logData);
        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "*",
            },
            body: JSON.stringify({
                message: "Event bus success"
            }),
        };
    } catch (error) {
        await mysql_con.rollback();
        console.log(error);
        // failure log
        await createLog(context, 'イベントバス', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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