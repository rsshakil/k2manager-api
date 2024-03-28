/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk');
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const s3 = new AWS.S3();
const fs = require('fs');
const stream = require('stream');
const archiver = require("archiver");
const { format } = require("date-fns");
//NOTE: only do it once per Node.js process/application, as duplicate registration will throw an error
archiver.registerFormat('zip-encrypted', require("archiver-zip-encrypted"));
const readline = require('readline');
const crypto = require('crypto')

process.env.TZ = 'Asia/Tokyo';
const BUCKET = 'k2reservation';
const CREATED_BY = 'system';

const common = require('./commonFunctions/checkFilter')

/**
 * CSVImport.
 *
 * @param {*} event
 * @returns
 */
exports.handler = async (event) => {

    let csvImportId = event.csvImportId;
    let projectId = event.projectId;
    let execedBy = (event.execedBy) ? event.execedBy : "system";
    if (!csvImportId) {
        return {
            statusCode: 400,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify("Invalid parameter"),
        };
    }

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
    console.log("1. CSVインポートの開始", csvImportId);
    try {
        // 1. 初期化処理　権限チェック
        mysql_con = await mysql.createConnection(writeDbConfig);
        await mysql_con.beginTransaction();
        // 2. ファイルを元にデータをDBから読み込み
        let csvImportSql = `SELECT * FROM CsvImport 
            INNER JOIN CsvImportTemplate ON CsvImport.csvImportTemplateId = CsvImportTemplate.csvImportTemplateId 
            INNER JOIN Event ON CsvImportTemplate.eventId = Event.eventId WHERE csvImportId = ? AND (csvImportStatus = 0 OR csvImportStatus = 1)`;
        var [csvImportResult] = await mysql_con.execute(csvImportSql, [csvImportId]);
        if (csvImportResult.length >= 1) {
            let eventId = csvImportResult[0].eventId
            console.log("2. CSVインポートデータの更新");
            // 2-1. インポートデータの更新
            const nowUnixtime = Math.floor(new Date() / 1000);
            let csvUpdateSql = `UPDATE CsvImport SET csvImportStatus = 1, updatedAt = ? WHERE csvImportId = ?`;
            var [csvImportUpdate] = await mysql_con.execute(csvUpdateSql, [nowUnixtime, csvImportId]);
            // 3. フィールド・フィルター情報をDBから取得し整形する
            console.log("3. フィールド・フィルター情報をDBから取得し整形する");
            let fieldData = []; // フィールドデータ
            let filterData = []; // フィルターデータ
            let fieldIdData = []; // フィールドID 配列
            let filterIdData = []; // フィルターID 配列
            let filterIdSetData = new Set(); // フィルターID Set型　一旦入れてから配列にする
            // フィールドデータを展開し、フィールドとフィルター情報に分ける
            for (let i = 0; i < csvImportResult[0].csvImportTemplateFieldQuery.length; i++) {
                let row = {
                    fieldId: csvImportResult[0].csvImportTemplateFieldQuery[i].fTypeId,
                    filter: []
                }
                if (csvImportResult[0].csvImportTemplateFieldQuery[i].tagBoxValue) {
                    for (let j = 0; j < csvImportResult[0].csvImportTemplateFieldQuery[i].tagBoxValue.length; j++) {
                        row.filter.push(csvImportResult[0].csvImportTemplateFieldQuery[i].tagBoxValue[j]);
                        filterIdSetData.add(csvImportResult[0].csvImportTemplateFieldQuery[i].tagBoxValue[j]);
                    }
                }
                fieldIdData.push(csvImportResult[0].csvImportTemplateFieldQuery[i].fTypeId);
                fieldData.push(row);
            }
            // セット型が使いづらいので配列に変換する
            for (let item of filterIdSetData) {
                filterIdData.push(item);
            }
            // fieldIdDataからSQLを実行してフィールドデータを作成する
            let fieldSql = `SELECT * FROM Field WHERE fieldId IN (?)`;
            var [fieldResult] = await mysql_con.query(fieldSql, [fieldIdData]);
            for (let i = 0; i < fieldResult.length; i++) {
                let row = fieldResult[i];
                for (let j = 0; j < fieldData.length; j++) {
                    if (row.fieldId == fieldData[j].fieldId) {
                        fieldData[j].fieldCode = row.fieldCode;
                        fieldData[j].fieldStyle = row.fieldStyle;
                        fieldData[j].fieldType = row.fieldType;
                        fieldData[j].fieldColumnName = row.fieldColumnName;
                        fieldData[j].projectId = row.projectId;
                    }
                }
            }
            // filterIdDataからSQLを実行してフィルターデータを作成する
            if (filterIdData.length >= 1) {
                let filterSql = `SELECT * FROM Filter WHERE filterId IN (?)`;
                var [filterResult] = await mysql_con.query(filterSql, [filterIdData]);
                for (let i = 0; i < filterResult.length; i++) {
                    let row = filterResult[i];
                    let data = {
                        filterId: row.filterId,
                        filterQuery: row.filterQuery
                    }
                    filterData.push(data);
                }
            }
            console.log("4. ファイルをS3から読み込む");
            // 4. ファイルをS3から読み込む
            let importData = [];
            let params = {
                Bucket: BUCKET,
                Key: csvImportResult[0].csvImportFilePath
            }
            const readStream = await s3.getObject(params).createReadStream();
            const rl = readline.createInterface({
                input: readStream,
                crlfDelay: Infinity
            });
            // for awaitで1行ずつ処理
            for await (const line of rl) {
                // let row = line.split(',').map((cell) => {
                let row = line.split(/,(?![^\[]*\])/).map((cell) => {
                    return cell.trim();
                });
                console.log("row", row);
                importData.push(row);
            }
            console.log("5. フィルターチェック", importData);
            // 5. フィルターチェック
            // 行展開
            let checkFlag = true;
            LOOP: for (let i = 1; i < importData.length; i++) {
                let userRow = importData[i];
                // セル展開
                for (let j = 0; j < userRow.length; j++) {
                    let cell = userRow[j];
                    let field = fieldData[j];
                    for (let k = 0; k < field.filter.length; k++) {
                        let filterId = field.filter[k];
                        for (let l = 0; l < filterData.length; l++) {
                            if (filterId == filterData[l].filterId) {
                                if (filterData[l].filterQuery) {
                                    let body = {};
                                    body[field.fieldCode] = {
                                        fieldValue: cell,
                                        fieldType: field.fieldType
                                    };
                                    if (!common.checkFilter(filterData[l].filterQuery, body)) {
                                        console.log("filterData[l].filterQuery", filterData[l].filterQuery);
                                        console.log("body", body);
                                        checkFlag = false;
                                        break LOOP;
                                    }
                                }
                            }
                        }
                    }
                }
            }
            // 一つでも失敗したら終了
            if (!checkFlag) {
                console.log("5-2. フィルターチェック失敗 CSVインポート終了");
                // データ更新
                const nowUnixtime = Math.floor(new Date() / 1000);
                let csvFailureSql = `UPDATE CsvImport SET csvImportStatus = 3, updatedAt = ? WHERE csvImportId = ?`;
                var [csvImportFailure] = await mysql_con.execute(csvFailureSql, [nowUnixtime, csvImportId]);
                let response = { message: "データの形式に誤りがある為CSVインポートを中止します。" };
                console.log("csvImportId", csvImportId);
                await mysql_con.commit();
                return {
                    statusCode: 400,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': '*',
                    },
                    body: JSON.stringify(response),
                };
            }
            console.log("6. データベースにデータの挿入開始");
            // 6. 問題がなければDBに挿入
            // 6-1. イベントデータの取得（トークン用）
            let eventSql = `SELECT
                Field1.fieldColumnName AS token1FieldColumnName,
                Field2.fieldColumnName AS token2FieldColumnName,
                Field3.fieldColumnName AS token3FieldColumnName
                FROM Event 
                LEFT OUTER JOIN Field AS Field1 ON Event.token1FieldId = Field1.fieldId
                LEFT OUTER JOIN Field AS Field2 ON Event.token2FieldId = Field2.fieldId
                LEFT OUTER JOIN Field AS Field3 ON Event.token3FieldId = Field3.fieldId
                WHERE Event.eventId = ?`;
            var [eventResult] = await mysql_con.execute(eventSql, [eventId]);
            const token1FieldColumnName = eventResult[0].token1FieldColumnName;
            const token2FieldColumnName = eventResult[0].token2FieldColumnName;
            const token3FieldColumnName = eventResult[0].token3FieldColumnName;
            // 顧客データのみ
            if (csvImportResult[0].csvImportTemplateType === 0) {
                console.log("7-1. 顧客データのみ");
                // 行ループ
                LOOP: for (let i = 1; i < importData.length; i++) {
                    let createdAt = Math.floor(new Date() / 1000);
                    let customerDataKey = "eventId, customerUUID, customerSystemId, createdAt, createdBy, updatedAt, updatedBy";
                    let customerDataValue = "?, UUID(), ?, ?, ?, ?, ?";
                    let customerDataParameter = [];
                    customerDataParameter.push(eventId);
                    customerDataParameter.push(getRandomData(8));
                    customerDataParameter.push(createdAt);
                    customerDataParameter.push(execedBy);
                    customerDataParameter.push(createdAt);
                    customerDataParameter.push(execedBy);
                    let customerFieldQuery = [];
                    let customerFieldFieldIdParameter = [];
                    let customerFieldDataParameter = [];
                    let userRow = importData[i];
                    console.log("row", userRow);
                    // セル展開
                    for (let j = 0; j < userRow.length; j++) {
                        let cell = userRow[j];
                        let field = fieldData[j];
                        // 特殊フィールド
                        if (field.projectId == 0) {
                            customerDataKey += ", " + field.fieldColumnName
                            customerDataValue += ", ?";
                            customerDataParameter.push(cell);
                            // 誕生日データがあった場合いろいろと計算する
                            if (field.fieldColumnName == "Customer.birthday") {
                                let birthdayStr = cell.substring(0, 4) + "/" + cell.substring(4, 6) + "/" + cell.substring(6, 8)
                                const birthdayDatetime = Math.floor(new Date(birthdayStr) / 1000);
                                customerDataKey += ", Customer.birthdayDatetime"
                                customerDataValue += ", ?";
                                customerDataParameter.push(birthdayDatetime);
                            }
                        }
                        // カスタムフィールド
                        else {
                            if (field.fieldType == 0 || field.fieldType == 1 || field.fieldType == 2) {
                                let customerFieldSql = `INSERT INTO CustomerField(customerId, fieldId, reservationNo, customerFieldText, createdAt, createdBy, updatedAt, updatedBy) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`;
                                customerFieldQuery.push(customerFieldSql);
                            }
                            else if (field.fieldType == 3) {
                                let customerFieldSql = `INSERT INTO CustomerField(customerId, fieldId, reservationNo, customerFieldList, createdAt, createdBy, updatedAt, updatedBy) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`;
                                customerFieldQuery.push(customerFieldSql);
                            }
                            else if (field.fieldType == 4) {
                                let customerFieldSql = `INSERT INTO CustomerField(customerId, fieldId, reservationNo, customerFieldBoolean, createdAt, createdBy, updatedAt, updatedBy) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`;
                                customerFieldQuery.push(customerFieldSql);
                            }
                            else if (field.fieldType == 5 || field.fieldType == 6 || field.fieldType == 7) {
                                let customerFieldSql = `INSERT INTO CustomerField(customerId, fieldId, reservationNo, customerFieldInt, createdAt, createdBy, updatedAt, updatedBy) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`;
                                customerFieldQuery.push(customerFieldSql);
                            }
                            customerFieldFieldIdParameter.push(field.fieldId);
                            customerFieldDataParameter.push(cell);
                        }
                    }
                    // const createdAt = Math.floor(new Date() / 1000);
                    // 顧客データの作成
                    var csvCustomerSql = `INSERT INTO Customer(${customerDataKey}) VALUES (${customerDataValue})`;
                    console.log("sql", csvCustomerSql);
                    console.log("param", customerDataParameter);
                    var [csvImportResult] = await mysql_con.query(csvCustomerSql, customerDataParameter);
                    // カスタマーフィールドの新規作成
                    for (let j = 0; j < customerFieldQuery.length; j++) {
                        let [customerFieldResult] = await mysql_con.execute(customerFieldQuery[j], [
                            csvImportResult.insertId,
                            customerFieldFieldIdParameter[j],
                            0,
                            customerFieldDataParameter[j],
                            createdAt,
                            createdAt,
                            createdAt,
                            createdAt
                        ]);
                    }
                    // 5-2. 関連するトークンデータの挿入
                    let tokenSQL = `SELECT ${token1FieldColumnName} AS token1FieldCode, ${token2FieldColumnName} AS token2FieldCode, ${token3FieldColumnName} AS token3FieldCode FROM Customer 
                        LEFT OUTER JOIN Reservation ON Customer.customerId = Reservation.customerId WHERE Customer.customerId = ?`;
                    // console.log("csvImportResult.insertId", csvImportResult.insertId);
                    let [tokenData] = await mysql_con.execute(tokenSQL, [csvImportResult.insertId]);
                    let token1FieldData = tokenData[0]["token1FieldCode"];
                    let token2FieldData = tokenData[0]["token2FieldCode"];
                    let token3FieldData = tokenData[0]["token3FieldCode"];
                    // トークン情報の更新
                    let sql_customer_update = `UPDATE Customer SET token1 = ?, token2 = ?, token3 = ? WHERE customerId = ?`;
                    let [customerCnt] = await mysql_con.execute(sql_customer_update, [token1FieldData, token2FieldData, token3FieldData, csvImportResult.insertId]);
                }
            }
            // 顧客データ + 予約データ
            else {
                console.log("7-2. 顧客と予約のデータ");
                // let customerDataKey = "";
                // let customerDataValue = "";
                // let customerDataParameter = [];
                // let reservationDataKey = "";
                // let reservationDataValue = "";
                // let reservationDataParameter = [];
                // let customerFieldQuery = [];
                // let customerFieldFieldIdParameter = [];
                // let customerFieldDataParameter = [];
                // 行ループ
                LOOP: for (let i = 1; i < importData.length; i++) {
                    let createdAt = Math.floor(new Date() / 1000);
                    let customerDataKey = "eventId, customerUUID, customerSystemId, createdAt, createdBy, updatedAt, updatedBy";
                    let customerDataValue = "?, UUID(), ?, ?, ?, ?, ?";
                    let customerDataParameter = [];
                    customerDataParameter.push(eventId);
                    customerDataParameter.push(getRandomData(8));
                    customerDataParameter.push(createdAt);
                    customerDataParameter.push(execedBy);
                    customerDataParameter.push(createdAt);
                    customerDataParameter.push(execedBy);
                    let reservationDataKey = "reservationStatus, reservationDatetime, createdAt, createdBy, updatedAt, updatedBy";
                    let reservationDataValue = "1, ?, ?, ?, ?, ?";
                    let reservationDataParameter = [];
                    reservationDataParameter.push(createdAt);
                    reservationDataParameter.push(createdAt);
                    reservationDataParameter.push(execedBy);
                    reservationDataParameter.push(createdAt);
                    reservationDataParameter.push(execedBy);
                    let customerFieldQuery = [];
                    let customerFieldFieldIdParameter = [];
                    let customerFieldDataParameter = [];
                    let userRow = importData[i];
                    // 必須パラメーター
                    let reservationEventSlotId = ""; // 時間枠ID
                    let reservationItemSlotId = []; // 検診内容枠ID
                    let reservationEventBusId = ""; // バスID バスを利用しない場合は不要 もしくは 0
                    // セル展開
                    for (let j = 0; j < userRow.length; j++) {
                        let cell = userRow[j];
                        let field = fieldData[j];
                        // 特殊フィールド
                        if (field.projectId == 0) {
                            // 顧客データ
                            if (field.fieldColumnName.startsWith("Customer.")) {
                                customerDataKey += ", " + field.fieldColumnName
                                customerDataValue += ", ?";
                                customerDataParameter.push(cell);
                                // 誕生日データがあった場合いろいろと計算する
                                if (field.fieldColumnName == "Customer.birthday") {
                                    let birthdayStr = cell.substring(0, 4) + "/" + cell.substring(4, 6) + "/" + cell.substring(6, 8)
                                    const birthdayDatetime = Math.floor(new Date(birthdayStr) / 1000);
                                    customerDataKey += ", Customer.birthdayDatetime"
                                    customerDataValue += ", ?";
                                    customerDataParameter.push(birthdayDatetime);
                                }
                            }
                            // 予約データ
                            else if (field.fieldColumnName.startsWith("Reservation.")) {
                                let createdAt = Math.floor(new Date() / 1000);
                                reservationDataKey += ", " + field.fieldColumnName
                                reservationDataValue += ", ?";
                                reservationDataParameter.push(cell);
                            }
                            // 予約データの作成に必要な必須パラメーターはここで取得する
                            // 時間枠ID
                            if (field.fieldColumnName == "Reservation.reservationEventSlotId") {
                                reservationEventSlotId = Number(cell)
                            }
                            // アイテム枠ID（リスト型）
                            if (field.fieldColumnName == "Reservation.reservationItemSlotId") {
                                let str = cell.slice(1)
                                str = str.slice(0, -1)
                                reservationItemSlotId = str.split(',') // Numberにしないと配列と見做されない
                            }
                            // バスID　なくてもいい
                            if (field.fieldColumnName == "Reservation.reservationEventBusId") {
                                reservationEventBusId = Number(cell)
                            }
                        }
                        // カスタムフィールド
                        else {
                            if (field.fieldType == 0 || field.fieldType == 1 || field.fieldType == 2) {
                                let customerFieldSql = `INSERT INTO CustomerField(customerId, fieldId, reservationNo, customerFieldText, createdAt, createdBy, updatedAt, updatedBy) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`;
                                customerFieldQuery.push(customerFieldSql);
                            }
                            else if (field.fieldType == 3) {
                                let customerFieldSql = `INSERT INTO CustomerField(customerId, fieldId, reservationNo, customerFieldList, createdAt, createdBy, updatedAt, updatedBy) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`;
                                customerFieldQuery.push(customerFieldSql);
                            }
                            else if (field.fieldType == 4) {
                                let customerFieldSql = `INSERT INTO CustomerField(customerId, fieldId, reservationNo, customerFieldBoolean, createdAt, createdBy, updatedAt, updatedBy) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`;
                                customerFieldQuery.push(customerFieldSql);
                            }
                            else if (field.fieldType == 5 || field.fieldType == 6 || field.fieldType == 7) {
                                let customerFieldSql = `INSERT INTO CustomerField(customerId, fieldId, reservationNo, customerFieldInt, createdAt, createdBy, updatedAt, updatedBy) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`;
                                customerFieldQuery.push(customerFieldSql);
                            }
                            customerFieldFieldIdParameter.push(field.fieldId);
                            customerFieldDataParameter.push(cell);
                        }
                    }
                    // const createdAt = Math.floor(new Date() / 1000);
                    // 顧客データの作成
                    var csvCustomerSql = `INSERT INTO Customer(${customerDataKey}) VALUES (${customerDataValue})`;
                    var [csvImportResult] = await mysql_con.query(csvCustomerSql, customerDataParameter);
                    let customerId = csvImportResult.insertId;
                    console.log("customerId", customerId);
                    // 予約データの作成
                    var csvReservationSql = `INSERT INTO Reservation(${reservationDataKey}, customerId) VALUES (${reservationDataValue}, ?)`;
                    reservationDataParameter.push(customerId);
                    var [csvReservationResult] = await mysql_con.query(csvReservationSql, reservationDataParameter);
                    let reservationId = csvReservationResult.insertId;
                    let reservationNo = await getReservationNo(eventId, reservationId);
                    console.log("reservationNo", reservationNo);
                    // 予約番号の更新
                    var csvReservationNoSql = `UPDATE Reservation SET reservationNo = ? WHERE reservationId = ?`;
                    [csvReservationResult] = await mysql_con.query(csvReservationNoSql, [reservationNo, reservationId]);
                    for (let j = 0; j < customerFieldQuery.length; j++) {
                        let [customerFieldResult] = await mysql_con.execute(customerFieldQuery[j], [
                            csvImportResult.insertId,
                            customerFieldFieldIdParameter[j],
                            reservationNo,
                            customerFieldDataParameter[j],
                            createdAt,
                            createdAt,
                            createdAt,
                            createdAt
                        ]);
                    }
                    // 予約データの作成（数値の増減など）
                    // 影響の出るテーブル
                    // EventSlot
                    // ReservationSlot
                    // イベントカテゴリー・イベント施設・イベントマッピング・イベントスロットをスロット情報を元に取得する
                    // バス利用
                    if (reservationEventBusId >= 1) {
                        let eventDataSql = `SELECT EventCategory.*,
                            EventInstitute.*,
                            EventMapping.*,
                            EventSlot.*,
                            EventBus.*
                        FROM EventSlot 
                        INNER JOIN EventMapping ON EventSlot.mappingId = EventMapping.mappingId
                        INNER JOIN EventInstitute ON EventMapping.eventInstituteId = EventInstitute.eventInstituteId
                        INNER JOIN EventCategory ON EventInstitute.eventCategoryId = EventCategory.eventCategoryId
                        INNER JOIN EventBus ON EventMapping.mappingId = EventBus.mappingId
                        WHERE EventSlot.slotId = ? AND EventBus.eventBusId = ?`;
                        let [eventData] = await mysql_con.execute(eventDataSql, [reservationEventSlotId, reservationEventBusId]);
                    }
                    // バスではない
                    else {
                        let eventDataSql = `SELECT EventCategory.*,
                            EventInstitute.*,
                            EventMapping.*,
                            EventSlot.*
                        FROM EventSlot 
                        INNER JOIN EventMapping ON EventSlot.mappingId = EventMapping.mappingId
                        INNER JOIN EventInstitute ON EventMapping.eventInstituteId = EventInstitute.eventInstituteId
                        INNER JOIN EventCategory ON EventInstitute.eventCategoryId = EventCategory.eventCategoryId
                        INNER JOIN EventBus ON EventMapping.mappingId = EventBus.mappingId
                        WHERE EventSlot.slotId = ?`;
                        let [eventData] = await mysql_con.execute(eventDataSql, [reservationEventSlotId]);
                    }
                    // 施設上限枠に対して減算処理
                    // let sql_update_eventslot = `UPDATE EventSlot SET commonReservationCount = commonReservationCount + 1, reservationCount = reservationCount + 1 
                    //     WHERE slotId = ? AND (commonReservationCount <= (maxReservationCount - 1))`;
                    let sql_update_eventslot = `UPDATE EventSlot 
                        LEFT OUTER JOIN EventMapping ON EventSlot.mappingId = EventMapping.mappingId
                        LEFT OUTER JOIN EventInstitute ON EventMapping.eventInstituteId = EventInstitute.eventInstituteId
                        LEFT OUTER JOIN EventCategory ON EventInstitute.eventCategoryId = EventCategory.eventCategoryId
                        SET 
                            EventSlot.commonReservationCount = EventSlot.commonReservationCount + 1, 
                            EventSlot.reservationCount = EventSlot.reservationCount + 1 
                        WHERE EventSlot.slotId = ? AND (commonReservationCount <= (maxReservationCount - 1)) AND EventCategory.eventId = ?`;
                    // console.log("sql_update_eventslot", sql_update_eventslot);
                    // console.log("slotId", jsonBody.reservationEventSlotId.fieldValue);
                    let [updateCnt] = await mysql_con.execute(sql_update_eventslot, [reservationEventSlotId, eventId]);
                    if (updateCnt.changedRows == 0) {
                        await mysql_con.rollback();
                        // await createLog(context, '検診予約', '作成', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, eventId, null, logData);
                        const nowUnixtime = Math.floor(new Date() / 1000);
                        let csvFailureSql = `UPDATE CsvImport SET csvImportStatus = 3, updatedAt = ? WHERE csvImportId = ?`;
                        var [csvImportFailure] = await mysql_con.execute(csvFailureSql, [nowUnixtime, csvImportId]);
                        console.log("予約失敗 施設上限枠の制限に引っかかりました", reservationEventSlotId);
                        return {
                            statusCode: 400,
                            headers: {
                                'Access-Control-Allow-Origin': '*',
                                'Access-Control-Allow-Headers': '*',
                            },
                            body: JSON.stringify({
                                message: "slotId " + reservationEventSlotId + " institute capacity over!",
                                errorCode: 201
                            }),
                        };
                    }
                    // アイテム枠に対して減算処理（チェイン情報などがあったらそちらも減算する）
                    // reservationItemSlotId = reservationItemSlotId.split(':');
                    console.log("reservationItemSlotId", reservationItemSlotId);
                    for (let i = 0; i < reservationItemSlotId.length; i++) {
                        let slotId = reservationItemSlotId[i];
                        if (slotId != null) {
                            console.log("update slotId", slotId);
                            // 更新方法の変更
                            // 同じmappingidかつ同じdatetimeかつ同じitemIdだった場合更新する
                            let sql_select_mapping_info = `SELECT mappingId, datetime, itemId, itemSubId,counselorId,counselorSubId FROM EventSlot WHERE slotId = ?`;
                            let [mapping_result] = await mysql_con.execute(sql_select_mapping_info, [slotId]);
                            let sql_select_mapping_info22 = `SELECT * FROM EventSlot WHERE slotId = ?`;
                            let [mapping_result22] = await mysql_con.execute(sql_select_mapping_info22, [slotId]);
                            console.log("slotId", slotId);
                            console.log("mapping_result", mapping_result[0]);
                            console.log("mapping_result22", mapping_result22[0]);
                            let slot_mappingId = mapping_result[0].mappingId;
                            let slot_datetime = mapping_result[0].datetime;
                            let slot_itemId = mapping_result[0].itemId === null ? mapping_result[0].counselorId : mapping_result[0].itemId;
                            let whereItemCounselorID = '';
                            let leftJoinItemCounselor = '';
                            let tableItemCounselor = '';
                            let selectorChain = '';
                            if (mapping_result[0].itemId === null) {
                                selectorChain = 'chainCounselorId';
                                tableItemCounselor = 'EventSubCounselor';
                                whereItemCounselorID = ` AND EventSlot.counselorId = ? AND EventSlot.counselorSubId = ? `;
                                leftJoinItemCounselor = ` EventSlot.counselorId = EventSubCounselor.counselorId AND EventSlot.counselorSubId = EventSubCounselor.counselorSubId `;
                            } else {
                                selectorChain = 'chainItemId';
                                tableItemCounselor = 'EventSubItem';
                                whereItemCounselorID = ` AND EventSlot.itemId = ? AND EventSlot.itemSubId = ? `;
                                leftJoinItemCounselor = ` EventSlot.itemId = EventSubItem.itemId AND  EventSlot.itemSubId = EventSubItem.itemSubId `;
                            }
                            console.log('tableItemCounselor', tableItemCounselor);
                            console.log('whereItemCounselorID', whereItemCounselorID);
                            console.log('leftJoinItemCounselor', leftJoinItemCounselor);
                            let slot_itemSubId = mapping_result[0].itemId === null ? mapping_result[0].counselorSubId : mapping_result[0].itemSubId;
                            // 更新
                            let sql_update_eventslot_option = `UPDATE EventSlot 
                                LEFT OUTER JOIN EventMapping ON EventSlot.mappingId = EventMapping.mappingId
                                LEFT OUTER JOIN EventInstitute ON EventMapping.eventInstituteId = EventInstitute.eventInstituteId
                                LEFT OUTER JOIN EventCategory ON EventInstitute.eventCategoryId = EventCategory.eventCategoryId
                            SET commonReservationCount = commonReservationCount + 1, reservationCount = reservationCount + 1 
                            WHERE EventSlot.mappingId = ? AND EventSlot.datetime = ? ${whereItemCounselorID} 
                                AND (EventSlot.commonReservationCount <= (EventSlot.maxReservationCount - 1)) AND EventCategory.eventId = ?`;
                            // sql_update_eventslot_option = `UPDATE EventSlot SET reservationCount = reservationCount + 1 WHERE slotId = ? AND (reservationCount <= (maxReservationCount - 1))`;
                            let [uCnt] = await mysql_con.execute(sql_update_eventslot_option, [slot_mappingId, slot_datetime, slot_itemId, slot_itemSubId, eventId]);
                            // console.log("uCnt ==== " + JSON.stringify(uCnt, null, '\t'));
                            if (uCnt.changedRows == 0) {
                                console.log("予約失敗 アイテム上限枠の制限に引っかかりました");
                                // throw (400, "slotId " + slotId + " institute capacity over!");
                                // failure log
                                // await createLog(context, '検診予約', '作成', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, eventId, null, logData);
                                await mysql_con.rollback();
                                const nowUnixtime = Math.floor(new Date() / 1000);
                                let csvFailureSql = `UPDATE CsvImport SET csvImportStatus = 3, updatedAt = ? WHERE csvImportId = ?`;
                                var [csvImportFailure] = await mysql_con.execute(csvFailureSql, [nowUnixtime, csvImportId]);
                                return {
                                    statusCode: 400,
                                    headers: {
                                        'Access-Control-Allow-Origin': '*',
                                        'Access-Control-Allow-Headers': '*',
                                    },
                                    body: JSON.stringify({
                                        message: "slotId " + slotId + " institute capacity over!",
                                        errorCode: 201
                                    }),
                                };
                            }
                            /*
                                let sql_select_mapping_info33 = `SELECT * FROM EventSubCounselor WHERE mappingId = ?`;
                                let sql_select_mapping_info44 = `SELECT * FROM EventSubItem WHERE mappingId = ?`;
                                let sql_select_mapping_info55 = `SELECT * FROM ReservationSlot`;
                                let [mapping_result33] = await mysql_con.execute(sql_select_mapping_info33, [slot_mappingId]);
                                let [mapping_result44] = await mysql_con.execute(sql_select_mapping_info44, [slot_mappingId]);
                                let [mapping_result55] = await mysql_con.execute(sql_select_mapping_info55);
                                console.log('mapping_result33',mapping_result33[0]);
                                console.log('mapping_result44',mapping_result44[0]);
                                console.log('mapping_result55',mapping_result55[0]);
                            */
                            // チェイン情報を確認し、紐付きがあれば同じく減らす
                            let sql_chain_get = `SELECT 
                                ${selectorChain}, EventSlot.mappingId, datetime FROM EventSlot LEFT OUTER JOIN ${tableItemCounselor} ON 
                                EventSlot.mappingId = ${tableItemCounselor}.mappingId AND 
                                ${leftJoinItemCounselor}
                                WHERE EventSlot.slotId = ?`;
                            console.log("chainData slotId", slotId);
                            let [chainData] = await mysql_con.execute(sql_chain_get, [slotId]);

                            if (chainData && chainData.length >= 1) {
                                console.log("chainData", chainData);
                                let chainDataSplits = [];
                                if (mapping_result[0].itemId === null) {
                                    chainDataSplits = String(chainData[0].chainCounselorId).split(',');
                                } else {
                                    chainDataSplits = String(chainData[0].chainItemId).split(',');
                                }

                                console.log("chainDataSplits", chainDataSplits);
                                console.log("chainDataSplits.length", chainDataSplits.length);
                                let chainMappingId = chainData[0].mappingId;
                                console.log("chainMappingId", chainMappingId);
                                let chainDatetime = chainData[0].datetime;
                                console.log("chainDatetime", chainDatetime);
                                for (let j = 0; j < chainDataSplits.length; j++) {
                                    let chainItemId = chainDataSplits[j].split(':')[0];
                                    if (chainItemId) {
                                        let chainItemSubId = chainDataSplits[j].split(':')[1];
                                        let chain_sql = `UPDATE EventSlot 
                                            LEFT OUTER JOIN EventMapping ON EventSlot.mappingId = EventMapping.mappingId
                                            LEFT OUTER JOIN EventInstitute ON EventMapping.eventInstituteId = EventInstitute.eventInstituteId
                                            LEFT OUTER JOIN EventCategory ON EventInstitute.eventCategoryId = EventCategory.eventCategoryId
                                            SET EventSlot.commonReservationCount = EventSlot.commonReservationCount + 1
                                            WHERE EventSlot.mappingId = ? AND EventSlot.datetime = ? ${whereItemCounselorID}
                                                AND (EventSlot.commonReservationCount <= (EventSlot.maxReservationCount - 1)) AND EventCategory.eventId = ?`;
                                        console.log("chain chainItemId", chainItemId);
                                        console.log("chain chainItemSubId", chainItemSubId);
                                        console.log("chain chainMappingId", chainMappingId);
                                        console.log("chain chainDatetime", chainDatetime);
                                        let [uCnt2] = await mysql_con.execute(chain_sql, [chainMappingId, chainDatetime, chainItemId, chainItemSubId, eventId]);
                                        if (uCnt2.changedRows == 0) {
                                            console.log("予約失敗 アイテム上限枠（チェイン）の制限に引っかかりました");
                                            // throw (400, "chain data eventslot capacity error!");
                                            // failure log
                                            // await createLog(context, '検診予約', '作成', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, eventId, null, logData);
                                            await mysql_con.rollback();
                                            const nowUnixtime = Math.floor(new Date() / 1000);
                                            let csvFailureSql = `UPDATE CsvImport SET csvImportStatus = 3, updatedAt = ? WHERE csvImportId = ?`;
                                            var [csvImportFailure] = await mysql_con.execute(csvFailureSql, [nowUnixtime, csvImportId]);
                                            return {
                                                statusCode: 400,
                                                headers: {
                                                    'Access-Control-Allow-Origin': '*',
                                                    'Access-Control-Allow-Headers': '*',
                                                },
                                                body: JSON.stringify({
                                                    message: "chain data eventslot capacity error!",
                                                    errorCode: 201
                                                }),
                                            };
                                        }
                                    }
                                }
                            }
                        }
                    }
                    //　バスの場合EventBusも更新する
                    if (reservationEventBusId != "" && reservationEventBusId >= 1) {
                        console.log("reservationEventBusId", reservationEventBusId);
                        let sql_update_eventbusway = `UPDATE EventBus INNER JOIN BusWay ON EventBus.busWayId = BusWay.busWayId
                        LEFT OUTER JOIN EventMapping ON EventBus.mappingId = EventMapping.mappingId
                        LEFT OUTER JOIN EventInstitute ON EventMapping.eventInstituteId = EventInstitute.eventInstituteId
                        LEFT OUTER JOIN EventCategory ON EventInstitute.eventCategoryId = EventCategory.eventCategoryId
                        SET busReservationCount = busReservationCount + 1 
                        WHERE busReservationCount < busWayCapacity AND  EventBus.eventBusId = ? AND EventCategory.eventId = ?`;
                        let [uCnt] = await mysql_con.execute(sql_update_eventbusway, [reservationEventBusId, eventId]);
                        if (uCnt.affectedRows == 0) {
                            console.log("予約失敗 バス定員枠の制限に引っかかりました");
                            // throw (400, "busway update failure!");
                            // failure log
                            // await createLog(context, '検診予約', '作成', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, eventId, null, logData);
                            await mysql_con.rollback();
                            const nowUnixtime = Math.floor(new Date() / 1000);
                            let csvFailureSql = `UPDATE CsvImport SET csvImportStatus = 3, updatedAt = ? WHERE csvImportId = ?`;
                            var [csvImportFailure] = await mysql_con.execute(csvFailureSql, [nowUnixtime, csvImportId]);
                            return {
                                statusCode: 400,
                                headers: {
                                    'Access-Control-Allow-Origin': '*',
                                    'Access-Control-Allow-Headers': '*',
                                },
                                body: JSON.stringify({
                                    message: "busway update failure!",
                                    errorCode: 201
                                }),
                            };
                        }
                    }
                    // ReservationSlotの作成
                    for (let i = 0; i < reservationItemSlotId.length; i++) {
                        // console.log("create ReservationSlot", reservationItemSlotId);
                        let slotId = reservationItemSlotId[i];
                        if (slotId != null) {
                            // let sql_eventslot_select = `SELECT * FROM EventSlot 
                            // LEFT OUTER JOIN EventSubItem ON EventSlot.itemId = EventSubItem.itemId AND EventSlot.itemSubId = EventSubItem.itemSubId AND EventSlot.mappingId = EventSubItem.mappingId WHERE slotId = ?`;
                            let sql_eventslot_select = `SELECT EventSlot.*, EventSubItem.*, EventSubCounselor.*, Field.* FROM EventSlot 
                                LEFT OUTER JOIN EventSubItem ON EventSlot.itemId = EventSubItem.itemId AND EventSlot.itemSubId = EventSubItem.itemSubId AND EventSlot.mappingId = EventSubItem.mappingId 
                                LEFT OUTER JOIN EventSubCounselor ON EventSlot.counselorId = EventSubCounselor.counselorId AND EventSlot.counselorSubId = EventSubCounselor.counselorSubId AND EventSlot.mappingId = EventSubCounselor.mappingId 
                                LEFT OUTER JOIN EventMapping ON EventSlot.mappingId = EventMapping.mappingId
                                LEFT OUTER JOIN EventInstitute ON EventMapping.eventInstituteId = EventInstitute.eventInstituteId
                                LEFT OUTER JOIN EventCategory ON EventInstitute.eventCategoryId = EventCategory.eventCategoryId
                                LEFT OUTER JOIN Event ON EventCategory.eventId = Event.eventId
                                LEFT OUTER JOIN Project ON Event.projectId = Project.projectId
                                LEFT OUTER JOIN Field ON Field.fieldType = 10 AND EventSlot.itemId = fieldColumnSubId AND Field.fieldColumnName = 'Item.itemId' AND Project.projectId = Field.projectId
                                WHERE slotId = ?`;
                            var [sql_eventslot_result] = await mysql_con.execute(sql_eventslot_select, [slotId]);
                            var sql_reservation_slot_insert = `INSERT INTO ReservationSlot(reservationId, customerId, slotId, itemId, eventSubItemId, counselorId, eventSubCounselorId, createdAt, createdBy, updatedAt, updatedBy) 
                                VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                            let slot_parameter = [];
                            slot_parameter.push(reservationId);
                            slot_parameter.push(customerId);
                            slot_parameter.push(slotId);
                            let itemIdValue = 0;
                            let eventSubItemIdValue = 0;
                            let counselorIdValue = 0;
                            let eventSubCounselorIdValue = 0;
                            if (sql_eventslot_result[0]?.itemId) {
                                itemIdValue = sql_eventslot_result[0]?.itemId;
                            }
                            if (sql_eventslot_result[0]?.eventSubItemId) {
                                eventSubItemIdValue = sql_eventslot_result[0]?.eventSubItemId;
                            }
                            if (sql_eventslot_result[0]?.counselorId) {
                                counselorIdValue = sql_eventslot_result[0]?.counselorId;
                            }
                            if (sql_eventslot_result[0]?.eventSubCounselorId) {
                                eventSubCounselorIdValue = sql_eventslot_result[0]?.eventSubCounselorId;
                            }
                            slot_parameter.push(itemIdValue);
                            slot_parameter.push(eventSubItemIdValue);
                            slot_parameter.push(counselorIdValue);
                            slot_parameter.push(eventSubCounselorIdValue);
                            slot_parameter.push(Math.floor(new Date().getTime() / 1000));
                            slot_parameter.push(execedBy);
                            slot_parameter.push(Math.floor(new Date().getTime() / 1000));
                            slot_parameter.push(execedBy);
                            console.log("slot_parameter", slot_parameter);
                            console.log("sql_eventslot_result", sql_eventslot_result);

                            var [query_result] = await mysql_con.execute(sql_reservation_slot_insert, slot_parameter);
                            // フィールドデータも作成する（アイテムの登録　CSV用）
                            var fieldInsert = `INSERT INTO CustomerField(customerId, fieldId, reservationNo, customerFieldBoolean, createdAt, createdBy, updatedAt, updatedBy) VALUES(?, ?, ?, 1, ?, ?, ?, ?)`;
                            var [sql_customerfield_result] = await mysql_con.execute(fieldInsert, [customerId, (sql_eventslot_result[0].fieldId != null) ? sql_eventslot_result[0].fieldId : 0, reservationNo, Math.floor(new Date().getTime() / 1000), execedBy, Math.floor(new Date().getTime() / 1000), execedBy]);
                        }
                    }
                    // 関連情報データの挿入
                    let eventDataResult;
                    // アイテムの連結と費用の集計
                    let itemCostSql = `SELECT GROUP_CONCAT(Item.itemName) AS reservationItemContents, SUM(EventSubItem.itemPrice) AS reservationItemCost
                        FROM EventSlot 
                        INNER JOIN EventSubItem ON EventSlot.mappingId = EventSubItem.mappingId AND EventSlot.itemId = EventSubItem.itemId AND EventSlot.itemSubId = EventSubItem.itemSubId
                        INNER JOIN Item ON EventSlot.itemId = Item.itemId
                        WHERE slotId IN (?)`;
                    let [itemCostResult] = await mysql_con.execute(itemCostSql, [reservationItemSlotId]);
                    console.log("itemCostResult", itemCostResult);
                    // バスの場合
                    if (reservationEventBusId >= 1) {
                        let eventDataSql = `SELECT 
                                Event.eventName,
                                Category.categoryName, 
                                EventCategory.eventCategoryId, 
                                Institute.instituteName,
                                EventInstitute.eventInstituteId,
                                Institute.institutePrefecture,
                                Institute.instituteCityName,
                                Institute.instituteTownName,
                                Institute.instituteAddressName,
                                Institute.instituteBuilding,
                                Institute.instituteZipCode,
                                Institute.instituteTelNo,
                                EventMapping.mappingId,
                                EventMapping.mappingDatetime,
                                EventSlot.datetime,
                                EventInstitute.eventInstituteSlotStyle,
                                EventMapping.receptionDatetimeFrom,
                                EventMapping.receptionDatetimeTo,
                                BusStop.busStopName,
                                BusStop.busStopAddress,
                                BusTimeTable.busTime,
                                EventBus.eventBusId
                            FROM EventSlot 
                                INNER JOIN EventMapping ON EventSlot.mappingId = EventMapping.mappingId
                                INNER JOIN EventBus ON EventMapping.mappingId = EventBus.mappingId
                                INNER JOIN BusWay ON EventBus.busWayId = BusWay.busWayId
                                INNER JOIN BusRoute ON BusWay.busRouteId = BusRoute.busRouteId
                                INNER JOIN BusRouteStop ON BusRoute.busRouteId = BusRouteStop.busRouteId
                                INNER JOIN BusStop ON BusRouteStop.busStopId = BusStop.busStopId
                                INNER JOIN BusTimeTable ON BusWay.busWayId = BusTimeTable.busWayId AND BusStop.busStopId = BusTimeTable.busStopId
                                INNER JOIN EventInstitute ON EventMapping.eventInstituteId = EventInstitute.eventInstituteId
                                INNER JOIN Institute ON EventInstitute.instituteId = Institute.instituteId
                                INNER JOIN EventCategory ON EventInstitute.eventCategoryId = EventCategory.eventCategoryId
                                INNER JOIN Category ON EventCategory.categoryId = Category.categoryId
                                INNER JOIN Event ON EventCategory.eventId = Event.eventId
                            WHERE EventSlot.slotId = ? AND EventBus.eventBusId = ?`;
                        [eventDataResult] = await mysql_con.execute(eventDataSql, [reservationEventSlotId, reservationEventBusId]);
                    }
                    else {
                        let eventDataSql = `SELECT 
                                Event.eventName,
                                Category.categoryName, 
                                EventCategory.eventCategoryId, 
                                Institute.instituteName,
                                EventInstitute.eventInstituteId,
                                Institute.institutePrefecture,
                                Institute.instituteCityName,
                                Institute.instituteTownName,
                                Institute.instituteAddressName,
                                Institute.instituteBuilding,
                                Institute.instituteZipCode,
                                Institute.instituteTelNo,
                                EventMapping.mappingId,
                                EventMapping.mappingDatetime,
                                EventSlot.datetime,
                                EventInstitute.eventInstituteSlotStyle,
                                EventMapping.receptionDatetimeFrom,
                                EventMapping.receptionDatetimeTo
                            FROM EventSlot 
                                INNER JOIN EventMapping ON EventSlot.mappingId = EventMapping.mappingId
                                INNER JOIN EventInstitute ON EventMapping.eventInstituteId = EventInstitute.eventInstituteId
                                INNER JOIN Institute ON EventInstitute.instituteId = Institute.instituteId
                                INNER JOIN EventCategory ON EventInstitute.eventCategoryId = EventCategory.eventCategoryId
                                INNER JOIN Category ON EventCategory.categoryId = Category.categoryId
                                INNER JOIN Event ON EventCategory.eventId = Event.eventId
                            WHERE EventSlot.slotId = ?`;
                        [eventDataResult] = await mysql_con.execute(eventDataSql, [reservationEventSlotId]);
                    }
                    reservationDataKey = "reservationEventId = ?";
                    reservationDataParameter = [];
                    reservationDataParameter.push(eventId)
                    // データの挿入処理
                    if (eventDataResult.length >= 1 && itemCostResult.length >= 1) {
                        let result = [];
                        // reservationEventName
                        if (eventDataResult[0].eventName !== undefined) {
                            reservationDataKey += ", reservationEventName = ?";
                            reservationDataParameter.push(eventDataResult[0].eventName)
                        }
                        // reservationEventCategoryName
                        if (eventDataResult[0].categoryName !== undefined) {
                            reservationDataKey += ", reservationEventCategoryName = ?";
                            reservationDataParameter.push(eventDataResult[0].categoryName)
                        }
                        // reservationEventCategoryId
                        if (eventDataResult[0].eventCategoryId !== undefined) {
                            reservationDataKey += ", reservationEventCategoryId = ?";
                            reservationDataParameter.push(eventDataResult[0].eventCategoryId)
                        }
                        // reservationEventInstituteName
                        if (eventDataResult[0].instituteName !== undefined) {
                            reservationDataKey += ", reservationEventInstituteName = ?";
                            reservationDataParameter.push(eventDataResult[0].instituteName)
                        }
                        // reservationEventInstituteId
                        if (eventDataResult[0].eventInstituteId !== undefined) {
                            reservationDataKey += ", reservationEventInstituteId = ?";
                            reservationDataParameter.push(eventDataResult[0].eventInstituteId)
                        }
                        // reservationEventInstituteMapData
                        if (eventDataResult[0].institutePrefecture !== undefined) {
                            reservationDataKey += ", reservationEventInstituteMapData = ?";
                            let mapValue = eventDataResult[0].institutePrefecture + eventDataResult[0].instituteCityName + eventDataResult[0].instituteTownName + eventDataResult[0].instituteAddressName + eventDataResult[0].instituteBuilding
                            reservationDataParameter.push(mapValue)
                        }
                        // reservationEventInstituteAddress
                        if (eventDataResult[0].instituteCityName !== undefined) {
                            reservationDataKey += ", reservationEventInstituteAddress = ?";
                            let instituteAddress = eventDataResult[0].instituteCityName + eventDataResult[0].instituteTownName + eventDataResult[0].instituteAddressName + eventDataResult[0].instituteBuilding
                            reservationDataParameter.push(instituteAddress)
                        }
                        // reservationEventInstituteNameAddress
                        if (eventDataResult[0].instituteName !== undefined) {
                            reservationDataKey += ", reservationEventInstituteNameAddress = ?";
                            let instituteNameAddress = eventDataResult[0].instituteName + "（" + eventDataResult[0].instituteCityName + eventDataResult[0].instituteTownName + eventDataResult[0].instituteAddressName + eventDataResult[0].instituteBuilding + "）"
                            reservationDataParameter.push(instituteNameAddress)
                        }
                        // reservationEventInstituteZipCode
                        if (eventDataResult[0].instituteZipCode !== undefined) {
                            reservationDataKey += ", reservationEventInstituteZipCode = ?";
                            reservationDataParameter.push(eventDataResult[0].instituteZipCode)
                        }
                        // reservationEventInstituteTelNo
                        if (eventDataResult[0].instituteTelNo !== undefined) {
                            reservationDataKey += ", reservationEventInstituteTelNo = ?";
                            reservationDataParameter.push(eventDataResult[0].instituteTelNo)
                        }
                        // reservationEventBusId
                        if (reservationEventBusId !== undefined && reservationEventBusId != "" && reservationEventBusId >= 1) {
                            reservationDataKey += ", reservationEventBusId = ?";
                            reservationDataParameter.push(reservationEventBusId)
                        }
                        // reservationEventBusStopAddress
                        if (eventDataResult[0].busStopAddress !== undefined) {
                            reservationDataKey += ", reservationEventBusStopAddress = ?";
                            reservationDataParameter.push(eventDataResult[0].busStopAddress)
                        }
                        // reservationEventBusTime
                        if (eventDataResult[0].busTime !== undefined) {
                            reservationDataKey += ", reservationEventBusTime = ?";
                            reservationDataParameter.push(eventDataResult[0].busTime)
                        }
                        // reservationEventMappingId
                        if (eventDataResult[0].mappingId !== undefined) {
                            reservationDataKey += ", reservationEventMappingId = ?";
                            reservationDataParameter.push(eventDataResult[0].mappingId)
                        }
                        // reservationReceiveDatetime
                        if (eventDataResult[0].mappingDatetime !== undefined) {
                            reservationDataKey += ", reservationReceiveDatetime = ?";
                            reservationDataParameter.push(eventDataResult[0].mappingDatetime)
                        }
                        // reservationAcceptanceStartTimeFrom
                        if (eventDataResult[0].datetime !== undefined && eventDataResult[0].datetime != 0) {
                            reservationDataKey += ", reservationAcceptanceStartTimeFrom = ?";
                            reservationDataParameter.push(eventDataResult[0].datetime)
                        }
                        // reservationAcceptanceStartTimeTo
                        // TODO
                        if (eventDataResult[0].datetime !== undefined && eventDataResult[0].eventInstituteSlotStyle.mappingInterval !== undefined) {
                            reservationDataKey += ", reservationAcceptanceStartTimeTo = ?";
                            // let intervalPlusTime = 0;
                            // eventDataResult.datetime
                            reservationDataParameter.push(eventDataResult[0].datetime)
                        }
                        // reservationExecutionTime
                        if (eventDataResult[0].datetime !== undefined && eventDataResult[0].datetime != 0) {
                            reservationDataKey += ", reservationExecutionTime = ?";
                            reservationDataParameter.push(eventDataResult[0].datetime)
                        }
                        // reservationStartDatetime
                        if (eventDataResult[0].receptionDatetimeFrom !== undefined) {
                            reservationDataKey += ", reservationStartDatetime = ?";
                            reservationDataParameter.push(eventDataResult[0].receptionDatetimeFrom)
                        }
                        // reservationEndDatetime
                        if (eventDataResult[0].receptionDatetimeTo !== undefined) {
                            reservationDataKey += ", reservationEndDatetime = ?";
                            reservationDataParameter.push(eventDataResult[0].receptionDatetimeTo)
                        }
                        // reservationItemContents
                        if (itemCostResult[0].reservationItemContents !== undefined) {
                            reservationDataKey += ", reservationItemContents = ?";
                            reservationDataParameter.push(itemCostResult[0].reservationItemContents)
                        }
                        // reservationItemCost
                        if (itemCostResult[0].reservationItemCost !== undefined) {
                            reservationDataKey += ", reservationItemCost = ?";
                            reservationDataParameter.push(itemCostResult[0].reservationItemCost)
                        }
                        var csvReservationSql = `UPDATE Reservation SET ${reservationDataKey} WHERE reservationId = ?`;
                        reservationDataParameter.push(reservationId);
                        var [csvReservationResult] = await mysql_con.query(csvReservationSql, reservationDataParameter);
                    }


                    // メールと削除の設定
                    // 顧客データ削除日の設定
                    const eventData = await getEventData(eventId, mysql_con);
                    const eventCustomerDeleteFlag = eventData.eventCustomerDeleteFlag;
                    let customerDeleteDatetime = null;
                    // 実施日の予約受付終了から指定日数
                    if (eventCustomerDeleteFlag === 1) {
                        customerDeleteDatetime = eventDataResult[0].receptionDatetimeTo + eventData.eventCustomerDeleteValue * 86400;
                    }
                    // イベント終了から指定日数
                    else if (eventCustomerDeleteFlag === 2) {
                        customerDeleteDatetime = eventData.eventEndDate + eventData.eventCustomerDeleteValue * 86400;
                    }
                    // リマインドメール送信日の設定
                    let customerReminderDatetime = null;
                    let customerReminderDate = null;
                    const eventReminderSendFlag = eventData.eventReminderSendFlag;
                    // 指定日数でリマインドメール送信
                    if (eventReminderSendFlag === 1) {
                        if (eventDataResult[0].mappingDatetime !== undefined) {
                            const date = Math.floor((new Date()).getTime() / 1000);
                            // let nowTime = (jsonBody.useTimeMachine)?(jsonBody?.timeDifference)? jsonBody?.timeDifference: date:date;
                            let nowTime = date;
                            // 予約日が検診日の前日または同日でない場合のみリマインドメールを送信する
                            if ((nowTime + 86400 + 43200) <= eventDataResult[0].mappingDatetime) {
                                customerReminderDatetime = eventDataResult[0].mappingDatetime - eventData.eventReminderSendValue * 86400;
                                customerReminderDate = eventData.eventReminderSendValue;
                            }
                        }
                    }
                    // 顧客情報を更新する
                    let sql_update_customer = `UPDATE Customer SET customerDeleteDatetime = ?, customerReminderDatetime = ?, customerReminderDate = ? WHERE customerId = ?`;
                    const [query_update_customer_result] = await mysql_con.execute(sql_update_customer, [
                        customerDeleteDatetime,
                        customerReminderDatetime,
                        customerReminderDate,
                        customerId
                    ]);

                    // 5-2. 関連するトークンデータの挿入 (最後)
                    let tokenSQL = `SELECT ${token1FieldColumnName} AS token1FieldCode, ${token2FieldColumnName} AS token2FieldCode, ${token3FieldColumnName} AS token3FieldCode FROM Customer 
                        LEFT OUTER JOIN Reservation ON Customer.customerId = Reservation.customerId WHERE Customer.customerId = ?`;
                    console.log("tokenSQL", tokenSQL);
                    let [tokenData] = await mysql_con.execute(tokenSQL, [customerId]);
                    let token1FieldData = tokenData[0]["token1FieldCode"];
                    let token2FieldData = tokenData[0]["token2FieldCode"];
                    let token3FieldData = tokenData[0]["token3FieldCode"];
                    let sql_customer_update = `UPDATE Customer SET token1 = ?, token2 = ?, token3 = ? WHERE customerId = ?`;
                    let [customerCnt] = await mysql_con.execute(sql_customer_update, [token1FieldData, token2FieldData, token3FieldData, customerId]);
                }
                // 予約数のカウントアップ
                let sql_update_event = `UPDATE Event SET reservationUserCount = reservationUserCount + ? WHERE eventId = ?`;
                const [query_update_event_result] = await mysql_con.execute(sql_update_event, [importData.length - 1, eventId]);
            }
            console.log("10. インポート正常終了");

            // construct the response
            let response = {};
            // console.log('this is response >>>>>>>>>>>>>>', response)
            let nowUnixtime2 = Math.floor(new Date() / 1000);
            let csvFailureSql = `UPDATE CsvImport SET csvImportStatus = 2, csvImportExecDatetime = ?, updatedAt = ? WHERE csvImportId = ?`;
            var [csvImportSuccess] = await mysql_con.execute(csvFailureSql, [nowUnixtime2, nowUnixtime2, csvImportId]);
            mysql_con.commit();
            return {
                statusCode: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(response),
            };
        }
        // データが不正
        else {
            mysql_con.rollback();
            console.log("1. データが不正 インポート異常終了");
            const nowUnixtime = Math.floor(new Date() / 1000);
            let csvFailureSql = `UPDATE CsvImport SET csvImportStatus = 3, updatedAt = ? WHERE csvImportId = ?`;
            var [csvImportFailure] = await mysql_con.execute(csvFailureSql, [nowUnixtime, csvImportId]);
            let response = { message: "データが不正" };
            console.log("csvImportId", csvImportId);
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(response),
            };
        }
    } catch (error) {
        if (mysql_con && csvImportId) {
            mysql_con.rollback();
            const nowUnixtime = Math.floor(new Date() / 1000);
            let csvFailureSql = `UPDATE CsvImport SET csvImportStatus = 3, updatedAt = ? WHERE csvImportId = ?`;
            var [csvImportFailure] = await mysql_con.execute(csvFailureSql, [nowUnixtime, csvImportId]);
            let response = { message: "データが不正" };
        }
        console.log(error);
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify(error),
        };
    }
    finally {
        if (mysql_con) await mysql_con.close();
    }
};


const getEventData = async (eventId, mysql_con) => {
    try {
        let sql_data = `SELECT
        Event.eventId,
        Event.eventName,
        Event.eventEndDate,
        Event.eventCustomerDeleteFlag,
        Event.eventCustomerDeleteValue,
        Event.eventReminderSendFlag,
        Event.eventReminderSendValue,
        Field1.fieldCode AS token1FieldCode,
        Field2.fieldCode AS token2FieldCode,
        Field3.fieldCode AS token3FieldCode,
        Field1.fieldColumnName AS token1FieldColumnName,
        Field2.fieldColumnName AS token2FieldColumnName,
        Field3.fieldColumnName AS token3FieldColumnName
        FROM Event
        LEFT OUTER JOIN Field AS Field1 ON Event.token1FieldId = Field1.fieldId
        LEFT OUTER JOIN Field AS Field2 ON Event.token2FieldId = Field2.fieldId
        LEFT OUTER JOIN Field AS Field3 ON Event.token3FieldId = Field3.fieldId
        WHERE eventId = ?`;
        let [data] = await mysql_con.query(sql_data, [eventId]);
        return data[0];
    }
    catch (err) {
        console.log("getEventData error ", err);
    }
};


const CHECK_DIGIT_SPECIFIED = 10;
const CHECK_DIGIT_COEFFICIENT = 2;
const CHECK_DIGIT_DATA_LENGTH = 10;

function getRandomData(length) {
    // create random hex
    var str = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    // return Array.from(Array(length)).map(()=>S[Math.floor(Math.random()*str.length)]).join('')
    return Array.from(crypto.randomFillSync(new Uint8Array(length))).map((n) => str[n % str.length]).join('')
}

const getReservationNo = async (eventId, reservationId) => {
    var eventHeader = ('000' + eventId).slice(-3);
    var sequenceNo = String(eventHeader + ('0000000' + reservationId).slice(-7));
    const reserveNo = await makeReserveNo(Number.parseInt(sequenceNo));
    console.log("reservationNo ====", reserveNo);
    return reserveNo;
};
const makeReserveNo = async (sequence_no) => {
    // console.log('Start ---- makeReserveNo');
    // console.log(sequence_no);

    // Check if the argument is a numeric string.
    if (false === Number.isInteger(Number.parseInt(sequence_no))) {
        throw new Error('Number format error.');
    }

    // Fill the beginning with zeros up to the specified length.
    let s_seq_no = String(sequence_no).padStart(CHECK_DIGIT_DATA_LENGTH, '0');

    // Slice if the number of digits exceeds the specified length.
    s_seq_no = s_seq_no.slice(s_seq_no.length - CHECK_DIGIT_DATA_LENGTH);

    // Add each character to the array.
    const array_split_seq_no = [...s_seq_no];
    const check_digit_1st = await checkDigit(array_split_seq_no);
    // console.log("check_digit_1st=" + check_digit_1st);

    // Add each character to the array and reverse it.
    const array_split_data_seq_no_rev = [...s_seq_no].reverse();
    const check_digit_2nd = await checkDigit(array_split_data_seq_no_rev);
    // console.log("check_digit_2nd=" + check_digit_2nd);

    // Add check digit to sequence number
    const reserve_no = s_seq_no + String(check_digit_1st) + String(check_digit_2nd);

    return reserve_no;
};

const checkDigit = async (data) => {
    // console.log('Start ---- checkDigit');
    // console.log(data);

    try {
        // Perform the following processes in order to get the check digit.
        // (1) Double the odd digits of the numerical data and add them up.
        // (2) Sum the even-numbered values of the number data.
        // (3) Total of odd and even numbers.
        // (4) Divide the total by 10 to find the remainder (modulus).
        // (5) The check digit is the remainder minus 10 (10 - remainder). However, if the remainder is 0, the check digit will also be '0'.

        let odd = 0;
        let even = 0;
        for (var i = 0; i < data.length; i++) {
            const num = Number.parseInt(data[i]);
            // even-odd process
            if (i % 2 !== 0) {
                // (1)
                var value = CHECK_DIGIT_COEFFICIENT * num;
                // In the case of 2 digits
                if (String(value).length === 2) {
                    var array = [...String(value)];
                    for (var k = 0; k < array.length; k++) {
                        odd += Number.parseInt(array[k]);
                    }
                } else {
                    odd += value;
                }
            } else {
                // (2)
                even += num;
            }
        }
        // console.log("odd=" + odd);
        // console.log("even=" + even);

        // (3)
        const total = odd + even;
        // console.log("total=" + total);

        // Divide the total by 10 to find the remainder(modulus).
        const remainder = total % CHECK_DIGIT_SPECIFIED;
        let check_digit = 0;
        if (remainder !== 0) {
            check_digit = CHECK_DIGIT_SPECIFIED - remainder;
        }
        // console.log('check_digit=' + check_digit);
        // console.log('End   ---- checkDigit');

        return check_digit;
    }
    catch (err) {
        console.error(err);
        throw err;
    }
};
