/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();

exports.handler = async (event, context, callback) => {
    // console.log('Received event:', JSON.stringify(event, null, 2));
    // console.log('event.body:', JSON.parse(event.body));
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
        process.env.DBINFO = true
    }
    // Database info
    let mysql_con;
    let readDbConfig = {
        host: process.env.DBWRITEENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET
    };
    // mysql connect
    mysql_con = await mysql.createConnection(readDbConfig);
    // total count sql
    let sql = `INSERT INTO ViewCode VALUES(?)`;
    try {
        //
        let viewCode;
        while (true) {
            viewCode = generateRandomString(10);
            var [query_result1] = await mysql_con.query(sql, [viewCode]);
            console.log(query_result1);
            if (query_result1.affectedRows >= 1) {
                break;
            }
        }
        console.log(viewCode);
        // return {viewCode: viewCode};
        return viewCode;
    } catch (error) {
        console.log(error)
        return null;
        // return {viewCode: null};
    }
};
/*
function getRandomStr() {
    // create random hex
    var S = "abcdefghijklmnopqrstuvwxyz"
    var N = 16
    let viewCode = Array.from(crypto.getRandomValues(new Uint8Array(N))).map((n)=>S[n%S.length]).join('')
    // const genRanStr = size => [...Array(size)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
    // let viewCode = genRanStr(8);
    return viewCode;
}
*/

const generateRandomString = (num) => {
    const characters ='abcdefghijklmnopqrstuvwxyz';
    let result = '';
    const charactersLength = characters.length;
    for (let i = 0; i < num; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}