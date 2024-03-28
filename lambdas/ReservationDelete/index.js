/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

const dynamodb = new AWS.DynamoDB();
let TABLE_NAME = "";
if (process.env.ENV === "develop") {
    TABLE_NAME = "Log-cftinn7tp5cnvlfbagqofhfdbq-develop";
} else if (process.env.ENV === "fork") {
    // 暫定処理
    TABLE_NAME = "Log-cftinn7tp5cnvlfbagqofhfdbq-develop";
} else if (process.env.ENV === "staging") {
    TABLE_NAME = "Log-jezb5kub4vfzfctavw5n332zkq-staging";
} else if (process.env.ENV === "product") {
    TABLE_NAME = "Log-bbruxshztnh4hlj45sj2kgghi4-product";
}
const INDEX_NAME = 'byCustomerByLogDateTime';

process.env.TZ = "Asia/Tokyo";

/**
 * ReservationDelete.
 * 
 * @param {*} event 
 * @returns {json} response
 */
exports.handler = async (event, context) => {
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
    let writeDbConfig = {
        host: process.env.DBWRITEENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET,
    };

    let mysql_con;
    try {
        // mysql connect
        mysql_con = await mysql.createConnection(writeDbConfig);
        await mysql_con.beginTransaction();

        const now = Math.floor(new Date() / 1000);
        let sql_customer = `SELECT Customer.customerId, Reservation.reservationId FROM Customer LEFT OUTER JOIN Reservation ON Customer.customerId = Reservation.customerId WHERE customerDeleteDatetime <= ? LIMIT 1000`;
        let sql_param = [now];

        // query template data
        var [query_customer_result] = await mysql_con.execute(sql_customer, sql_param);
        console.log("query_customer_result", query_customer_result);

        const customerIdArray = query_customer_result.map((row) => row.customerId);
        const reservationIdArray = query_customer_result.map((row) => row.reservationId);
        console.log("delete customerIds", customerIdArray);
        console.log("delete reservationIds", reservationIdArray);

        // delete Customer records
        // delete CustomerField records
        if (customerIdArray.length !== 0) {
            let sql_customer_delete = `DELETE FROM Customer WHERE customerId IN (?)`;
            const [customer_delete_result] = await mysql_con.query(sql_customer_delete, [customerIdArray]);
            console.log("customer_delete_result", customer_delete_result);

            let sql_customer_ffield_delete = `DELETE FROM CustomerField WHERE customerId IN (?)`;
            const [customer_field_delete_result] = await mysql_con.query(sql_customer_ffield_delete, [customerIdArray]);
            console.log("customer_field_delete_result", customer_field_delete_result);
        }

        // delete Reservation records
        if (reservationIdArray.length !== 0) {
            let sql_reservation_delete = `DELETE FROM Reservation WHERE reservationId IN (?)`;
            const [reservation_delete_result] = await mysql_con.query(sql_reservation_delete, [reservationIdArray]);
            console.log("reservation_delete_result", reservation_delete_result);
        }

        // delete Log dynamoDB
        const deleteBatch = async (items) => {
            const params = {
              RequestItems: {
                [TABLE_NAME]: items.map(item => ({
                  DeleteRequest: {
                    Key: { logId: { S: item.logId } }
                  }
                }))
              }
            };
            //console.log('deleteBatch params', JSON.stringify(params, null, 4));
            await dynamodb.batchWriteItem(params).promise();
        };

        const deleteByCustomerId = async (customerId) => {
            let lastEvaluatedKey = null;
            do {
              const params = {
                TableName: TABLE_NAME,
                IndexName: INDEX_NAME,
                KeyConditionExpression: 'customerId = :customerId',
                ProjectionExpression: 'logId, customerId', // replace with the names of the attributes you want to retrieve
                ExpressionAttributeValues: { ':customerId': { N: String(customerId) } },
                Limit: 25,
                ExclusiveStartKey: lastEvaluatedKey
              };
              const data = await dynamodb.query(params).promise();
              //console.log(JSON.stringify(data, null, 4));
              const items = data.Items.map(item => AWS.DynamoDB.Converter.unmarshall(item));
              if(data.Items.length > 0) {
                 await deleteBatch(items);
              }
              lastEvaluatedKey = data.LastEvaluatedKey;
              console.log('lastEvaluatedKey', lastEvaluatedKey);
            } while (lastEvaluatedKey !== undefined);
        };
        
        for (let i=0; i < customerIdArray.length; i++) {
            await deleteByCustomerId(customerIdArray[i]);
        }

        await mysql_con.commit();

        for (let i=0; i < customerIdArray.length; i++) {
            let logData = [];
            // ログ書き込み
            logData[0] = {};
            logData[0].fieldName = "顧客ID";
            logData[0].beforeValue = customerIdArray[i];
            logData[0].afterValue = "";
            await createLog(context, '顧客情報', '削除', '成功', '200', '', 'システム', logData);
        }

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
        };
    } catch (error) {
        await mysql_con.rollback();
        console.log("error:", error);
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