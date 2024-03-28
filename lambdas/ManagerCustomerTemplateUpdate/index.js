/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerCustomerTemplateUpdate.
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
        customerTemplateMemo,
        sortedItems,
        updatedBy,
        projectId
    } = JSON.parse(event.body) || '';
    logAccountId = updatedBy;

    let validProjectId;
    if (event?.requestContext?.authorizer?.pid) {
        validProjectId = JSON.parse(event?.requestContext?.authorizer?.pid);
        // pidがない場合 もしくは 許可プロジェクトIDに含まれていない場合
        if (!projectId || validProjectId.indexOf(Number(projectId)) == -1) {
            // failure log
            await createLog(context, '顧客テンプレート', '更新', '失敗', '403', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
    let mysql_con;
    try {
        // mysql connect
        mysql_con = await mysql.createConnection(writeDbConfig);
        await mysql_con.beginTransaction();
        // beforeDataの作成
        let beforeSql = `SELECT customerTemplateMemo FROM Project WHERE projectId = ?`;
        let [beforeResult] = await mysql_con.execute(beforeSql, [projectId]);

        // ログ書き込み
        logData[0] = {};
        logData[0].fieldName = "プロジェクトID";
        logData[0].beforeValue = projectId;
        logData[0].afterValue = projectId;
        logData[1] = {};
        logData[1].fieldName = "並び順";
        logData[1].beforeValue = '';
        logData[1].afterValue = sortedItems;
        logData[2] = {};
        logData[2].fieldName = "メモ";
        logData[2].beforeValue = beforeResult[0].memo;
        logData[2].afterValue = customerTemplateMemo;

        console.log("response:", JSON.stringify(event.body));
        console.log('customerTemplateMemo', customerTemplateMemo);
        console.log('sortedItems', JSON.stringify(sortedItems));
        console.log('projectId', projectId);

        // update memo if exists
        const sql_for_memo = `UPDATE Project SET customerTemplateMemo = ? WHERE projectId = ?`;
        let [query_result] = await mysql_con.execute(sql_for_memo, [customerTemplateMemo, projectId]);
        // console.log('query_result', query_result);

        // update sort order of template
        if (sortedItems && sortedItems.length > 0) {
            // console.log('get item id');
            let itemIds = sortedItems.map(item => item.id);
            itemIds = itemIds.join(',');
            // console.log('get itemsss id', itemIds);

            let wh = '';
            sortedItems.map((item, index) => {
                // console.log('updateitem id ', item.id);
                // console.log('updateitem index ', index);
                wh += ` WHEN ${item.id} THEN ${index} `;
            });

            let sortLists = `CASE customerViewTemplateId ${wh} END`;
            // console.log('get sortLists id', sortLists);
            let sql_update = `UPDATE CustomerViewTemplate SET sort = ${sortLists} WHERE customerViewTemplateId IN(${itemIds}) AND projectId = ?`;
            // console.log('sql_update', sql_update);
            let [query_result22] = await mysql_con.execute(sql_update, [projectId]);
            // console.log('query_result22', query_result22);
        }

        await mysql_con.commit();
        // construct the response
        let response = {
            records: 0
        };
        console.log("response:", response);
        // success log
        await createLog(context, '顧客テンプレート', '更新', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
        await createLog(context, '顧客テンプレート', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
