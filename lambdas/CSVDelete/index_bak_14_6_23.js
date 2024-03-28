/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk');
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const s3 = new AWS.S3();

process.env.TZ = 'Asia/Tokyo';
const BUCKET = 'k2reservation';

/**
 * CSVDelete.
 *
 * @param {*} event
 * @returns
 */
exports.handler = async (event) => {
    console.log("Event data:", event);
    // let projectId = event.projectId;
    // if (!projectId) {
    //     return {
    //         statusCode: 400,
    //         headers: {
    //             'Access-Control-Allow-Origin': '*',
    //             'Access-Control-Allow-Headers': '*',
    //         },
    //         body: JSON.stringify("Invalid parameter"),
    //     };
    // }

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
        let sql_csv = `SELECT * FROM CSV WHERE csvDeletionDatetime <= ?`;
        let sql_param = [now];

        // query template data
        var [query_csv_result] = await mysql_con.execute(sql_csv, sql_param);
        console.log("query_csv_result", query_csv_result);

        let deleteCsvIds = [];
        // loop on the list obtained
        for (let index = 0; index < query_csv_result.length; index++) {
            const element = query_csv_result[index];
            try {
                // delete CSV file from S3
                const deletes = await s3.deleteObject(
                    {
                        Bucket: BUCKET,
                        Key: element.csvPath
                    }).promise().catch(err => {
                        throw new Error(err);
                    });
            } catch (err) {
                console.log(err);
            }
            deleteCsvIds.push(element.csvId);
        }

        // delete CSV records
        let sql_delete = `DELETE from CSV WHERE csvId IN (?)`;
        var [query_delete_result] = await mysql_con.query(sql_delete, [deleteCsvIds]);

        await mysql_con.commit();
        // success log
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