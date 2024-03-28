/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
 const AWS = require("aws-sdk");
 const mysql = require("mysql2/promise");
 const ssm = new AWS.SSM();
 
 process.env.TZ = "Asia/Tokyo";
 
 /**
  * @param {*} event 
  * @returns {json} response
  */
 exports.handler = async (event) => {
     console.log("Event data:", event);
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
 
     if (event.appCode) {
        let appCode = event.appCode;
        if (event?.appAuthApiId) {
            let appAuthApiId = event.appAuthApiId;
            
            const updatedAt = Math.floor(new Date().getTime() / 1000);
            let sql_data = `UPDATE App SET
                appAuthApiId = ?,
                updatedAt = ?,
                updatedBy = "script"
                WHERE appCode = ?;`;
            let sql_param = [
                appAuthApiId,
                updatedAt,
                appCode
            ];
            console.log("sql_data:", sql_data);
            console.log("sql_param:", sql_param);
    
            let mysql_con;
            try {
                // mysql connect
                mysql_con = await mysql.createConnection(writeDbConfig);
                await mysql_con.beginTransaction();
                let [query_result] = await mysql_con.execute(sql_data, sql_param);
   
                if (query_result.affectedRows == 0) {
                    console.log("Not found");
                    await mysql_con.rollback();
                    return {
                        statusCode: 400,
                        headers: {
                            "Access-Control-Allow-Origin": "*",
                            "Access-Control-Allow-Headers": "*",
                        },
                        body: JSON.stringify({
                            message: "Not found",
                            errorCode: 201
                        }),
                    };
                }
                // construct the response
                let response = {
                    records: query_result[0]
                };
                console.log("response:", response);
                await mysql_con.commit();
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
         let appInitializeStatus = event.appInitializeStatus ? event.appInitializeStatus : 0;

         const updatedAt = Math.floor(new Date().getTime() / 1000);
         let sql_data = `UPDATE App SET
             appInitializeStatus = ?,
             updatedAt = ?,
             updatedBy = "setup-app.sh"
             WHERE appCode = ?;`;
         let sql_param = [
             appInitializeStatus,
             updatedAt,
             appCode
         ];
         console.log("sql_data:", sql_data);
         console.log("sql_param:", sql_param);
 
         let mysql_con;
         try {
             // mysql connect
             mysql_con = await mysql.createConnection(writeDbConfig);
             await mysql_con.beginTransaction();
             let [query_result] = await mysql_con.execute(sql_data, sql_param);

             if (query_result.affectedRows == 0) {
                 console.log("Not found");
                 await mysql_con.rollback();
                 return {
                     statusCode: 400,
                     headers: {
                         "Access-Control-Allow-Origin": "*",
                         "Access-Control-Allow-Headers": "*",
                     },
                     body: JSON.stringify({
                         message: "Not found",
                         errorCode: 201
                     }),
                 };
             }
             // construct the response
             let response = {
                 records: query_result[0]
             };
             console.log("response:", response);
             await mysql_con.commit();
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
 };