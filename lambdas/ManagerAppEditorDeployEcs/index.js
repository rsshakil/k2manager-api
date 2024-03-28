const AWS = require("aws-sdk");
const lambda = new AWS.Lambda();
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();

var writeDbConfig;

exports.handler = async (event, context) => {
    var status;
    var message;
    console.log("event: ", event);
    let logData = [];
    let logAccountId;
    let appDeployStatus = 0;
    let appId;
    // AIS 2023/7/24追加 start
    let appBaseId;
    // AIS End

    try {
        logAccountId = event.requestContext.authorizer.accountId;
        let authToken = event.headers.Authorization;
        authToken = authToken.replace(" ", "");
        appId = event.pathParameters.appId;
        
        let jsonBody = event.queryStringParameters;
        appBaseId = jsonBody?.appBaseId;

        let appData = await getAppData(appId);
        // ログ書き込み
        logData[0] = {};
        logData[0].fieldName = "イベントID";
        logData[0].beforeValue = appData[0].eventId;
        logData[0].afterValue = appData[0].eventId;
        logData[1] = {};
        logData[1].fieldName = "APP名";
        logData[1].beforeValue = appData[0].appName;
        logData[1].afterValue = appData[0].appName;
        logData[2] = {};
        logData[2].fieldName = "AppBaseId";
        logData[2].beforeValue = appData[0].appBaseCurrentId;
        logData[2].afterValue = appBaseId;

        appDeployStatus = 0;
        await updateDeploymentFS(appId, 1, appDeployStatus);

        let payload = {
            "command": [
                "/bin/bash",
                "-c",
                `cd /root && mv k2deploy k2deploy_${process.env.ENV} && cd k2deploy_${process.env.ENV} && git pull && git checkout ${process.env.ENV} && git pull && yarn install && node deploy.mjs ${appId} ${authToken} ${appBaseId}`
            ]
        };

        let params = {
            Payload: JSON.stringify(payload),
            FunctionName: "RunEcsTask-" + process.env.ENV,
            InvocationType: "Event"
        };
        console.log("params: ", params);

        console.log("Going to invoke lambda");
        let res = await lambda.invoke(params).promise();
        console.log("res: ", res);

        appDeployStatus = 10;
        await updateDeploymentFS(appId, 1, appDeployStatus);

        status = 200;
        message = "success";

        // success log
        await createLog(context, 'APPデザイナー', 'デプロイ', '成功', '200', event.requestContext.identity.sourceIp, logAccountId, logData);
    }
    catch (error) {
        console.log("error: ", error);
        status = 500;
        message = "error";

        appDeployStatus += 5;
        await updateDeploymentFS(appId, 0, appDeployStatus);

        // failure log
        await createLog(context, 'APPデザイナー', 'デプロイ', '失敗', '500', event.requestContext.identity.sourceIp, logAccountId, logData);
    }

    const response = {
        statusCode: status,
        body: JSON.stringify(message),
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': '*',
        }
    };

    return response;
};

async function updateDeploymentFS(appId, flag=0, status=100)
{
    console.log("Going to update deploy flag and status to ", {flag, status});
    let mysqlConnection;
    await getDBConfig();

    try {
        mysqlConnection = await mysql.createConnection(writeDbConfig);
        let appQuery = `UPDATE App SET appDeployFlag = ?, appDeployStatus = ? WHERE appId = ?`;
        await mysqlConnection.query(appQuery, [flag, status, appId]);
        console.log("Updated deploy flag and status to ", {flag, status});
    }
    catch(error) {
        console.log("Failed to update deploy flag/status");
        throw error;
    }
    finally {
        await mysqlConnection.end();
    }
}

async function getAppData(appId)
{
    let mysqlConnection;
    await getDBConfig();

    try {
        mysqlConnection = await mysql.createConnection(writeDbConfig);
        let appQuery = `SELECT eventId, appName, appBaseCurrentId FROM App WHERE appId = ?`;
        const [result] = await mysqlConnection.query(appQuery, [appId]);
        console.log("result", result);
        return result;
    }
    catch(error) {
        console.log("Failed to get App");
        throw error;
    }
    finally {
        await mysqlConnection.end();
    }
}

async function getDBConfig()
{
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
    writeDbConfig = {
        host: process.env.DBWRITEENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET,
    };
}

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
