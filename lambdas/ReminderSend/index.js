/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ReminderSend.
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
    let mysql_con2;
    try {
        // mysql connect
        mysql_con = await mysql.createConnection(writeDbConfig);

        const now = Math.floor(new Date() / 1000);
        let sql_customer = `SELECT
        Customer.customerId,
        Reservation.reservationNo AS reservationNo,
        Reservation.reservationEventCategoryId AS eventCategoryId,
        Event.eventId,
        Event.eventMailFlag
        FROM Customer
        INNER JOIN Reservation ON Customer.customerId = Reservation.customerId
        INNER JOIN Event ON Reservation.reservationEventId = Event.eventId
        WHERE customerReminderDatetime <= ? AND Reservation.reservationStatus = 1`;
        let sql_param = [now];

        // query template data
        var [query_customer_result] = await mysql_con.execute(sql_customer, sql_param);
        console.log("query_customer_result", query_customer_result);

        if (query_customer_result.length !== 0) {
            let customerArray = [];
            // Iterate with number of customers
            for (let index = 0; index < query_customer_result.length; index++) {
                let row = query_customer_result[index];
                let customer = {
                    eventId: row.eventId,
                    eventCategoryId: row.eventCategoryId,
                    eventMailFlag: row.eventMailFlag,
                    customerId: row.customerId,
                    reservationNo: row.reservationNo
                };
                customerArray.push(customer);
            }
            console.log("reminder send customers", customerArray);

            // sleep process
            const _sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

            let customerIdArray = [];
            // reminder send customer records
            for (let index = 0; index < customerArray.length; index++) {
                let v = customerArray[index];
                await sendReminder(v.eventMailFlag, v.eventId, v.eventCategoryId, v.customerId, v.reservationNo);
                customerIdArray.push(v.customerId);
                // 送信レートは 1秒で14メールなので、1秒遅延させる
                await _sleep(1000);
            }

            // 送信完了したらリマインドメール送信日時をNULLでUPDATEする
            mysql_con2 = await mysql.createConnection(writeDbConfig);
            let sql_update_data = `UPDATE Customer SET customerReminderDatetime = NULL WHERE customerId IN (?);`;
            const [customer_customer_result] = await mysql_con2.query(sql_update_data, [customerIdArray]);
            console.log("customer_customer_result", customer_customer_result);
        }

        // success log
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
        };
    } catch (error) {
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
        if (mysql_con2) await mysql_con2.close();
    }
};

async function sendReminder(eventMailFlag, eventId, eventCategoryId, customerId, reservationNo) {
    if (eventMailFlag === 1 || eventMailFlag === 3) {
        // send remind email
        let params = {
            FunctionName: "EmailSenderFunction-" + process.env.ENV,
            InvocationType: "Event",
            Payload: JSON.stringify({
                "eventId": eventId,
                "eventCategoryId": eventCategoryId,
                "emailTemplateTypeFlag": 3,
                "customerId": customerId,
                "reservationNo": reservationNo
            }),
        };
        await lambda.invoke(params).promise();
    }
    if (eventMailFlag === 2 || eventMailFlag === 3) {
        // send remind SMS
        let params = {
            FunctionName: "SMSSenderFunction-" + process.env.ENV,
            InvocationType: "Event",
            Payload: JSON.stringify({
                "eventId": eventId,
                "eventCategoryId": eventCategoryId,
                "smsTemplateTypeFlag": 3,
                "customerId": customerId,
                "reservationNo": reservationNo
            }),
        };
        await lambda.invoke(params).promise();
    }
}