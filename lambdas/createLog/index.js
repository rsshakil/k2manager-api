/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
var AWS = require('aws-sdk');
process.env.TZ = "Asia/Tokyo";

// var dynamo = new AWS.DynamoDB();
const docClient = new AWS.DynamoDB.DocumentClient({ region: "ap-northeast-1" });
const uuid = require('uuid');

exports.handler = async (event) => {
    let itemRow = {};
    itemRow.logId = uuid.v4();
    itemRow.logDateTime = Math.floor(new Date().getTime() / 1000);
    if (event.logGroupName) itemRow.logGroupName = event.logGroupName;
    if (event.logStreamName) itemRow.logStreamName = event.logStreamName;
    if (event._target) itemRow._target = event._target;
    if (event._type) itemRow._type = event._type;
    if (event._result) itemRow._result = event._result;
    if (event._code) itemRow._code = event._code;
    if (event.logData) itemRow.logData = event.logData;
    if (event.ipAddress) itemRow.ipAddress = event.ipAddress;
    if (event.projectId) itemRow.projectId = event.projectId;
    if (event.accountId) itemRow.accountId = event.accountId;
    if (event.eventId) itemRow.eventId = event.eventId;
    if (event.customerId) itemRow.customerId = event.customerId;
    itemRow.type = event.customerId ? "customer-log" : "log"; // require
    

    let tableName = "";
    if (process.env.ENV === "develop") {
        tableName = "Log-cftinn7tp5cnvlfbagqofhfdbq-develop";
    } else if (process.env.ENV === "fork") {
        // 暫定処理
        tableName = "Log-cftinn7tp5cnvlfbagqofhfdbq-develop";
    } else if (process.env.ENV === "staging") {
        tableName = "Log-jezb5kub4vfzfctavw5n332zkq-staging";
    } else if (process.env.ENV === "product") {
        tableName = "Log-bbruxshztnh4hlj45sj2kgghi4-product";
    }

    let param = {
        TableName: tableName,
        Item: itemRow
    };

    await docClient.put(param, function (err, data) {
        if (err) {
            console.error("Unable to add item. Error JSON:", JSON.stringify(err, null, 2));
            // } else {
            //     console.log("Added item:", JSON.stringify(param.Item, null, 2));
            // return obj;
        }
    }).promise();

    return;
}