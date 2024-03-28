/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerRoleCreate.
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

    let mysql_con;
    try {
        const {
            roleName,
            isMFAEnabled,
            r1,
            r2,
            r3,
            r4,
            r5,
            r6,
            r7,
            r8,
            r9,
            r10,
            r11,
            r12,
            r13,
            r14,
            r15,
            loginProjectId,
            roleRelationStyle,
            memo,
            createdBy,
            updatedBy
        } = JSON.parse(event.body);
        logAccountId = createdBy;
        // スタイルに値が入っていた場合解析してリレーションデータを作成数する
        // 何が来るかわからないためまだ作成できない
        let relationProjectId = [];
        let relationEventId = [];
        let relationInstituteId = [];
        if (roleRelationStyle && roleRelationStyle.projectEvent && roleRelationStyle.projectEvent.length >= 1) {
            // console.log("xxx----2");
            // relationProjectId = Object.keys(roleRelationStyle);
            let relationProject = roleRelationStyle.projectEvent;
            for (let i = 0; i < relationProject.length; i++) {
                relationProjectId.push(relationProject[i].id);
                if (relationProject[i]?.eventTag) {
                    relationProject[i].eventTag.map((value) => {
                        relationEventId.push(value);
                    });
                }
                if (relationProject[i]?.instituteTag) {
                    // relationInstituteId.push(roleRelationStyle[i]?.instituteTag);
                    relationProject[i].instituteTag.map((value) => {
                        relationInstituteId.push(value);
                    });
                }
            }
        }

        console.log("relationProjectId = ", relationProjectId);
        console.log("relationEventId = ", relationEventId);
        console.log("relationInstituteId = ", relationInstituteId);

        // ログ書き込み
        logData[0] = {};
        logData[0].fieldName = "ロール名";
        logData[0].beforeValue = "";
        logData[0].afterValue = roleName;
        logData[1] = {};
        logData[1].fieldName = "二段階認証";
        logData[1].beforeValue = "";
        logData[1].afterValue = isMFAEnabled;
        logData[2] = {};
        logData[2].fieldName = "システム管理権限";
        logData[2].beforeValue = "";
        logData[2].afterValue = r1;
        logData[3] = {};
        logData[3].fieldName = "システム監視権限";
        logData[3].beforeValue = "";
        logData[3].afterValue = r2;
        logData[4] = {};
        logData[4].fieldName = "APP管理権限";
        logData[4].beforeValue = "";
        logData[4].afterValue = r3;
        logData[5] = {};
        logData[5].fieldName = "イベント一覧権限";
        logData[5].beforeValue = "";
        logData[5].afterValue = r4;
        logData[6] = {};
        logData[6].fieldName = "イベントスケジューラー権限";
        logData[6].beforeValue = "";
        logData[6].afterValue = r5;
        logData[7] = {};
        logData[7].fieldName = "スロット権限";
        logData[7].beforeValue = "";
        logData[7].afterValue = r6;
        logData[8] = {};
        logData[8].fieldName = "データ管理権限";
        logData[8].beforeValue = "";
        logData[8].afterValue = r7;
        logData[9] = {};
        logData[9].fieldName = "顧客情報閲覧権限";
        logData[9].beforeValue = "";
        logData[9].afterValue = r8;
        logData[10] = {};
        logData[10].fieldName = "顧客情報管理権限";
        logData[10].beforeValue = "";
        logData[10].afterValue = r9;
        logData[11] = {};
        logData[11].fieldName = "CSVエクスポート権限";
        logData[11].beforeValue = "";
        logData[11].afterValue = r10;
        logData[12] = {};
        logData[12].fieldName = "CSVインポート権限";
        logData[12].beforeValue = "";
        logData[12].afterValue = r10;
        logData[13] = {};
        logData[13].fieldName = "ログインプロジェクト";
        logData[13].beforeValue = "";
        logData[13].afterValue = loginProjectId;
        logData[14] = {};
        logData[14].fieldName = "ロールリレーションJSON";
        logData[14].beforeValue = "";
        logData[14].afterValue = roleRelationStyle;
        logData[15] = {};
        logData[15].fieldName = "リレーションプロジェクトID";
        logData[15].beforeValue = "";
        logData[15].afterValue = relationProjectId;
        logData[16] = {};
        logData[16].fieldName = "リレーションイベントID";
        logData[16].beforeValue = "";
        logData[16].afterValue = relationEventId;
        logData[17] = {};
        logData[17].fieldName = "リレーション施設ID";
        logData[17].beforeValue = "";
        logData[17].afterValue = relationInstituteId;
        logData[18] = {};
        logData[18].fieldName = "メモ";
        logData[18].beforeValue = "";
        logData[18].afterValue = memo;

        // insert data query
        let sql_data = `INSERT INTO Role (
            roleName,
            isMFAEnabled,
            r1,
            r2,
            r3,
            r4,
            r5,
            r6,
            r7,
            r8,
            r9,
            r10,
            r11,
            r12,
            r13,
            r14,
            r15,
            loginProjectId,
            roleRelationStyle,
            relationProjectId,
            relationEventId,
            relationInstituteId,
            memo,
            createdAt,
            createdBy,
            updatedAt,
            updatedBy
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`;
        // created date
        const createdAt = Math.floor(new Date().getTime() / 1000);
        let sql_param = [
            roleName,
            isMFAEnabled,
            r1,
            r2,
            r3,
            r4,
            r5,
            r6,
            r7,
            r8,
            r9,
            r10,
            r11,
            r12,
            r13,
            r14,
            r15,
            loginProjectId,
            roleRelationStyle,
            (relationProjectId.length == 0) ? null : relationProjectId,
            (relationEventId.length == 0) ? null : relationEventId,
            (relationInstituteId.length == 0) ? null : relationInstituteId,
            memo,
            createdAt,
            createdBy,
            createdAt,
            updatedBy,
        ];
        console.log("sql_data:", sql_data);
        console.log("sql_param:", sql_param);

        // mysql connect
        mysql_con = await mysql.createConnection(writeDbConfig);
        const [query_result] = await mysql_con.execute(sql_data, sql_param);
        if (query_result.length === 0) {
            // failure log
            await createLog(context, 'ロール', '作成', '失敗', '404', event.requestContext.identity.sourceIp, logAccountId, logData);
            return {
                statusCode: 404,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "*",
                },
                body: JSON.stringify({
                    message: "no data"
                }),
            };
        }
        // construct the response
        let response = {
            records: query_result[0]
        };
        // console.log("response:", response);
        // success log
        await createLog(context, 'ロール', '作成', '成功', '200', event.requestContext.identity.sourceIp, logAccountId, logData);
        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "*",
            },
            body: JSON.stringify(response),
        };
    } catch (error) {
        console.log("error:", error);
        // failure log
        await createLog(context, 'ロール', '作成', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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