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
const ja = require('date-fns/locale/ja');
//NOTE: only do it once per Node.js process/application, as duplicate registration will throw an error
archiver.registerFormat('zip-encryptable', require("archiver-zip-encryptable"));

process.env.TZ = 'Asia/Tokyo';
const BUCKET = 'k2reservation';
const DEST_DIR = 'csv';
const CREATED_BY = 'system';

const commonFunctions = require('./commonFunctions/getWhereFromFilter');
const commonFunctions2 = require('./commonFunctions/getUserDataFromFilter');
const commonFunctions3 = require('./commonFunctions/changeCharacterHalf');
const commonFunctions4 = require('./commonFunctions/changeCharacterFull');
const convert = require('iconv-lite');
const encoding = require('encoding-japanese');

const tableLimit = 50;
const maxRecordsLimit = 50000;

/**
 * CSVGenerate.
 *
 * @param {*} event
 * @returns
 */
exports.handler = async (event) => {

    let csvExportTemplateId = event.csvExportTemplateId;
    if (!csvExportTemplateId) {
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
    try {
        // create a date in YYYY-MM-DD HH:Mi format
        const now = new Date();
        var cYear = now.getFullYear();
        var cMonth = ("00" + (now.getMonth() + 1)).slice(-2);
        var cDay = ("00" + now.getDate()).slice(-2);
        var cHours = ("00" + now.getHours()).slice(-2);
        var cMinutes = ("00" + now.getMinutes()).slice(-2);
        var cSeconds = ("00" + now.getSeconds()).slice(-2);
        var createdDateTime = cYear + '-' + cMonth.substring(-2) + '-' + cDay.substring(-2) + ' ' + cHours.substring(-2) + ':' + cMinutes.substring(-2) + ':' + cSeconds.substring(-2);

        console.log('writeDbConfig', writeDbConfig);
        mysql_con = await mysql.createConnection(writeDbConfig);
        await mysql_con.beginTransaction();
        console.log('csvExportTemplateId', csvExportTemplateId);

        // テンプレートデータの読み込み
        let sql_template = `SELECT * FROM CsvExportTemplate LEFT OUTER JOIN Filter ON CsvExportTemplate.filterId = Filter.filterId 
INNER JOIN Project ON CsvExportTemplate.projectId = Project.projectId WHERE csvExportTemplateId = ? LIMIT 1`;
        // query template data
        var [query_template_result] = await mysql_con.execute(sql_template, [csvExportTemplateId]);
        // console.log("query_template_result", query_template_result);

        // プロジェクトID、エンコードパターン、パスワード取得
        const projectId = query_template_result[0].projectId;
        const encodePattern = query_template_result[0].projectCsvCharacterCode;
        const password = query_template_result[0].csvExportTemplatePassword;

        // CSV name
        const fileName = query_template_result[0].csvExportTemplateFileName;
        const zipFileName = fileName ? fileName.replace(/\//g, '_') : '';
        const csvName = `${fileName ? fileName : ''}`;
        const zipCsvName = `${zipFileName}_${createdDateTime}`;
        // S3 file path
        const filePath = `${DEST_DIR}/${zipCsvName}.zip`;

        // From here, the process of creating a CSV record ////////////////////////////////////////////////////////////////////////////////////////////////////
        let sql_insert = `INSERT INTO CSV (projectId, csvExportTemplateId, csvName, csvCreateDatetime, csvDownloadPassword, csvPath, csvDeletionDatetime, createdAt, createdBy, updatedAt, updatedBy, csvCount)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`;
        let nowUnixtime = Math.floor(now / 1000);
        // get deletion date count
        let automaticDeletion = query_template_result[0].csvExportTemplateAutomaticDeletion;
        let deletionDatetime = 2147483647;
        if (Number.parseInt(automaticDeletion, 10) !== 0) {
            deletionDatetime = nowUnixtime + (86400 * automaticDeletion);
        }

        const parameter = [
            projectId,
            csvExportTemplateId,
            zipCsvName,
            nowUnixtime,
            password,
            null,
            deletionDatetime,
            nowUnixtime,
            CREATED_BY,
            nowUnixtime,
            CREATED_BY,
            0
        ];

        var [query_result3] = await mysql_con.execute(sql_insert, parameter);
        if (query_result3.affectedRows === 0) {
            mysql_con.rollback();
            return {
                statusCode: 404,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify({ message: 'no data' }),
            };
        }

        mysql_con.commit();
        // テンプレートカラム部分を取得
        let csvExportTemplateColumn = JSON.parse(JSON.stringify(query_template_result[0].csvExportTemplateColumn));
        console.log('csvExportTemplateColumn', JSON.stringify(csvExportTemplateColumn));
        if (!csvExportTemplateColumn || (csvExportTemplateColumn.length < 1)) {
            return;
        }

        let headerData = [];
        let fieldColumnsArr = [];
        let query_field_result = [];

        let fromQuery = "";

        // csvExportTemplateColumnを元にSQLを作成
        // 以前は 取得するデータだけ持ってきていたが、フィルターやカスタム値が入ってきたため全ての関連するデータを取得する
        let filterDataQuery = [];
        // リスト用フィールドID
        let listFieldIds = [];
        let fieldIds = [];
        let listTypeFieldStyle = [];


        if (csvExportTemplateColumn) {
            csvExportTemplateColumn.sort(function (a, b) { return a.currentPos - b.currentPos });

            let conditionalColumnFilterIds = [];

            // Getting fileds ID
            csvExportTemplateColumn.forEach(item => {
                fieldIds.push(item.fTypeId);

                if (Array.isArray(item.innerDrag)) {
                    item.innerDrag.forEach(x => conditionalColumnFilterIds.push(x.fTypeId));
                }
            });


            let conditionalColumnFieldCodes = [];

            if (conditionalColumnFilterIds.length > 0) {
                const sql_data = `SELECT filterQuery FROM Filter WHERE filterId IN (?)`;

                let [query_result] = await mysql_con.query(sql_data, [conditionalColumnFilterIds]);

                //   console.log('my checkign ----------> query_result', JSON.stringify(query_result))


                const conditionMatch = (conditionArray = []) => {
                    let key = conditionArray[0];
                    const operation = conditionArray[1];
                    const filterValue = conditionArray[2];

                    if (key.includes('.')) key = key.split('.')[1]

                    conditionalColumnFieldCodes.push(key);

                    if (operation == "same" || operation == "notsame") {
                        conditionalColumnFieldCodes.push(filterValue);
                    }
                }


                let deps = 0;
                const checkFilterCirculator = (filters = []) => {
                    let result = true;
                    let latestCheck = true;
                    let check;

                    if (result === false && deps === 0) return false;

                    for (let i = 0; i < filters.length; i++) {
                        //For condition
                        if (filters.length == 3 && (filters[1] != "and" && filters[1] != "or")) {
                            check = conditionMatch(filters);
                            latestCheck = check;

                            return latestCheck;
                        }
                        //GoTo nested array
                        else {
                            let row = filters[i];

                            // AND ORだった場合
                            if (!Array.isArray(row)) {
                                ++deps;

                                //(cond1 && cond2) : If left part is false then return false.
                                //Because no need to check right part as we know (false & true/false) = false
                                if (row == "and") {
                                    if (latestCheck === false) {
                                        --deps;
                                        result = false;
                                        return result;
                                    }
                                }
                                //(cond1 || cond2) : If left part is true then return true.
                                //Because no need to check right part as we know (true || true/false) = true
                                else {
                                    if (latestCheck === true) {
                                        --deps;
                                        return true
                                    }
                                }
                            }
                            // 条件の場合 (For condition)
                            else if (row[1] != "and" && row[1] != "or") {
                                check = conditionMatch(row);
                                latestCheck = check;
                            }
                            // 子供条件だった場合
                            else {
                                ++deps;
                                check = checkFilterCirculator(row);
                                latestCheck = check;
                            }
                        }
                    }
                    --deps;

                    return latestCheck;
                }


                query_result.forEach(filter => {
                    checkFilterCirculator(filter.filterQuery)
                    deps = 0;
                });
            }

            //
            if (conditionalColumnFieldCodes.length > 0) {
                const sql_data = `SELECT GROUP_CONCAT(fieldId) AS conditionColumnFieldIds FROM Field WHERE fieldCode IN (?)`;
                const [conditionalColumnFieldsData] = await mysql_con.query(sql_data, [conditionalColumnFieldCodes]);
                const conditionalColumnFieldIds = conditionalColumnFieldsData.length > 0 ? conditionalColumnFieldsData[0]?.conditionColumnFieldIds?.split(',') : [];

                fieldIds = [...fieldIds, ...conditionalColumnFieldIds];
            }

            // Getting field name
            let sql_field = `SELECT fieldName, fieldId, fieldColumnName, projectId, fieldType, fieldStyle, fieldCode FROM Field ${(fieldIds.length > 0) ?
                `WHERE fieldId IN(${fieldIds}) ORDER BY FIELD( fieldId, ${fieldIds})` : ''};`;
            console.log('fields sql_field', sql_field);
            [query_field_result] = await mysql_con.query(sql_field);
            console.log('query_field_result', query_field_result);

            let numOfField = 1;
            csvExportTemplateColumn = csvExportTemplateColumn.map(column => {
                // console.log("data column", column);
                let targetFieldResult = query_field_result.find(item => item.fieldId == column.fTypeId);
                // If column name exist push it otherwise push field name
                if (column?.csvColumnName) {
                    headerData.push(column.csvColumnName);
                } else {
                    // console.log("targetFieldResult", targetFieldResult);
                    headerData.push(targetFieldResult.fieldName);
                }

                //for special fields
                if (targetFieldResult.projectId == 0) {
                    switch (targetFieldResult.fieldType) {
                        case 3:
                            listFieldIds.push(column.fTypeId);
                        default:
                            fieldColumnsArr.push(targetFieldResult.fieldColumnName);
                    }
                }
                //for custom fields
                else {
                    // let fName = '';

                    // switch (targetFieldResult.fieldType) {
                    //     case 0:
                    //     case 1:
                    //     case 2:
                    //         //text
                    //         fName = 'customerFieldText';
                    //         break;
                    //     case 3:
                    //         //list
                    //         fName = 'customerFieldList';
                    //         listFieldIds.push(column.fTypeId);
                    //         break;
                    //     case 4:
                    //         //bool
                    //         fName = 'customerFieldBoolean';
                    //         break;
                    //     case 5:
                    //     case 6:
                    //     case 7:
                    //         //int
                    //         fName = 'customerFieldInt';
                    //         break;

                    // }

                    console.log('targetFieldResult >>>>>>>>>>>>>>>>>.', JSON.stringify(targetFieldResult))
                    if (targetFieldResult.fieldType == 3) {
                        let fCode = targetFieldResult.fieldCode;
                        let fStyle = targetFieldResult.fieldStyle;
                        listTypeFieldStyle.push({ customFCode: fCode, customFStle: fStyle });
                    }
                    // fieldColumnsArr.push(`f${numOfField}.${targetFieldResult.fieldId}`);
                    fieldColumnsArr.push(`f${numOfField}.orgField_${targetFieldResult.fieldCode}`);
                    // fieldColumnsArr.push(`f${numOfField}.${fName}`);
                    // customerViewTemplateFrom += ` LEFT OUTER JOIN CustomerField AS f${numOfField} ON Customer.customerId 
                    // = f${numOfField}.customerId AND f${numOfField}.fieldId = ${targetFieldResult.fieldId} `;
                    numOfField++;
                }

                if (column.innerDrag !== undefined) {
                    for (let i = 0; i < column.innerDrag.length; i++) {
                        filterDataQuery.push(column.innerDrag[i].fTypeId);
                    }
                }
                column.fieldCode = targetFieldResult.fieldCode;

                return { ...column, projectId: targetFieldResult.projectId }; // projectId add to identify is it customField or specialField
            });
        }
        // リスト行があるか？
        var fieldQueryListData;
        if (listFieldIds.length >= 1) {
            let fieldQuery = `SELECT fieldStyle FROM Field WHERE fieldId IN (?)`;
            [fieldQueryListData] = await mysql_con.query(fieldQuery, [listFieldIds]);
        }
        console.log("fieldQueryListData", fieldQueryListData);

        console.log('fieldIds check -----------> len count: ', fieldIds.length);
        // カスタマーフィールドを含む全てのユーザーデータを取得する
        // fieldCodeはそのままだと使えないので カスタムフィールドは orfField_ が頭に入っている
        let fieldColumns = '';
        let fieldFrom = '';

        let fieldColumnSQL = `SELECT * FROM Field WHERE projectId = ? AND fieldType IN (0, 1, 2, 3, 4, 5, 6, 7) AND fieldId IN (?)`;
        let [fieldColumnSQLData] = await mysql_con.query(fieldColumnSQL, [projectId, fieldIds]);

        console.log('fieldIds check -----------> All Fields count: ', fieldIds.length);
        console.log('fieldIds check -----------> customerFields count: ', fieldColumnSQLData.length)

        for (let i = 0; i < fieldColumnSQLData.length; i++) {
            let fName = '';
            switch (fieldColumnSQLData[i].fieldType) {
                case 0:
                case 1:
                case 2:
                    //text
                    fName = 'customerFieldText';
                    break;
                case 3:
                    //list
                    fName = 'customerFieldList';
                    break;
                case 4:
                    //bool
                    fName = 'customerFieldBoolean';
                    break;
                case 5:
                case 6:
                case 7:
                    //int
                    fName = 'customerFieldInt';
                    break;

            }
            fieldColumns += `, f${i}.${fName} AS orgField_${fieldColumnSQLData[i].fieldCode}`;
            fieldFrom += ` LEFT OUTER JOIN CustomerField AS f${i} ON Customer.customerId = f${i}.customerId AND f${i}.fieldId = ${fieldColumnSQLData[i].fieldId} AND Reservation.reservationNo = f${i}.reservationNo`
        }

        let fieldInfo = [];
        let filterQueryInfo = [];
        if (filterDataQuery.length >= 1) {
            let filterQueryInfoSQL = `SELECT filterId, filterQuery FROM Filter WHERE filterId IN (?)`;
            [filterQueryInfo] = await mysql_con.query(filterQueryInfoSQL, [filterDataQuery]);
            let fieldInfoQuery = `SELECT fieldCode, fieldColumnName, fieldType FROM Field WHERE projectId = 0 OR projectId = ?`;
            [fieldInfo] = await mysql_con.query(fieldInfoQuery, [projectId]);
        }
        console.log('filterQueryInfo', filterQueryInfo);

        console.log('fieldColumnsArr', fieldColumnsArr);
        // console.log('customerViewTemplateFrom', customerViewTemplateFrom);

        // Here comma separator string with double quotetion
        console.log("headerData csv header array",headerData)
        // headerData = headerData.join(',');//its causes a bug when header item exists a coma value
        
        //"a,a", "bb", "cc", "ddd" to display like this
        let headerItems= "";
        for(let x=0;x<headerData.length;x++){
            headerItems += '\"' + headerData[x] + '\",';
        }
        headerItems = headerItems.replace(/,\s*$/, "");//remove last comma
        headerData = headerItems;

        console.log("headerData csv header string coma",headerData)

        // let fieldColumns = '';
        let itemAliasArr = [];

        fieldColumnsArr.forEach((item, i) => {
            // console.log("item", item);
            // let itemAlias = item.replace('.', '_');
            let itemAlias = item.split('.');
            // console.log("itemAlias", itemAlias);
            itemAliasArr.push(itemAlias[1]);
            // itemAliasArr.push(item[1]);
            // Do something if is the last iteration of the array

            // if ((i + 1) == (fieldColumnsArr.length)) {
            //     fieldColumns += `${item} `;
            // } else {
            //     fieldColumns += `${item}, `;
            // }
        });
        console.log('headerData', headerData);
        console.log('fieldColumns', fieldColumns);
        console.log('itemAliasArr', itemAliasArr);

        /*
                let sql_count = `SELECT
                count(Reservation.updatedAt) AS count
                FROM Reservation
                INNER JOIN Customer ON Reservation.customerId = Customer.customerId
                WHERE 1 AND Reservation.updatedAt >= ${from} AND Reservation.updatedAt <= ${to}
                ORDER BY Reservation.updatedAt DESC`;
        */
        // 条件があるかどうか？


        let whereQuery = " WHERE Event.projectId = ? ";

        if (query_template_result[0].filterId >= 1) {
            // console.log("filterData --- 1", query_template_result[0].filterQuery);
            if ((query_template_result[0].filterQuery).length > 0) {
                let queryArray = await commonFunctions.getWhereFromFilter(mysql_con, query_template_result[0].filterQuery);
                console.log('queryArray--->', queryArray);
                if (queryArray?.length > 0) {
                    fromQuery = queryArray[0];
                    whereQuery += queryArray[1];
                }
            }
        }

        // let customerFieldNum = 0;
        // if (filterQueryInfo.length >= 1) {
        //     for (let j = 0; j < filterQueryInfo.length; j++) {

        //     }
        //     for (let j = 0; j < filterQueryInfo.length; j++) {
        //         customerFieldNum = j;
        //         fromQuery += `LEFT OUTER JOIN CustomerField AS f${customerFieldNum} ON Customer.customerId = f${customerFieldNum}.customerId AND CustomerField.fieldId = ${filterQueryInfo[j].fieldId} `;
        //     }
        // }

        console.log("from句 === ", fromQuery);
        console.log("where句 === ", whereQuery);

        // console.time('test_sql_count');

        // let sql_count = `SELECT
        //     count(Reservation.updatedAt) AS count
        //     FROM Customer AS Customer
        //     LEFT OUTER JOIN Reservation ON Customer.customerId = Reservation.customerId
        //     LEFT OUTER JOIN Event ON Customer.eventId = Event.eventId
        //     ${fromQuery}
        //     ${whereQuery}
        //     ORDER BY Reservation.updatedAt DESC`;

        // // query count
        // var [query_count_result] = await mysql_con.query(sql_count, [projectId]);
        // console.log('query_count_result', query_count_result[0].count);
        // let recordCount = query_count_result[0].count;

        // console.timeEnd('test_sql_count');


        // console.log('total records count ---------------------->', recordCount)

        // this is lambda region tmp files
        let tmpFiles = [];
        // Get the number of lines written to one file
        const numberToDivideLines = process.env.NUMBER_TO_DIVIDED_LINES;

        if (!numberToDivideLines) throw Error(`Env NUMBER_TO_DIVIDED_LINES is undefined`);

        // 一件でもあればCSV発行
        //if (recordCount >= 1) {
        /*
                    let sql_data = `SELECT ${fieldColumns}
                        FROM Reservation
                        INNER JOIN Customer ON Reservation.customerId = Customer.customerId
                        ${customerViewTemplateFrom}
                        WHERE Reservation.updatedAt >= ${from} AND Reservation.updatedAt <= ${to}
                        ORDER BY Reservation.updatedAt DESC`;
        */
        /*
                    let sql_data = `SELECT ${fieldColumns}
                        FROM Reservation
                        INNER JOIN Customer ON Reservation.customerId = Customer.customerId
                        ${customerViewTemplateFrom}
                        ${fromQuery}
                        ${whereQuery}
                        ORDER BY Reservation.updatedAt DESC`;
        */
        // max join table　対策 最大値を超える場合複数回に分けてデータを取得
        let fieldColumnsArray = fieldColumns.split(",")
        let fieldFromArray = fieldFrom.split(" LEFT OUTER JOIN")
        let maxCount = Math.ceil(fieldIds.length / tableLimit);
        // let maxCount = Math.ceil(fieldColumnsArray.length / tableLimit);
        console.log("tableLimit", tableLimit);
        console.log("fieldColumns.length", fieldColumns.length);
        let x = tableLimit;
        // 多次元配列の初期化
        let fieldColumns2 = []
        let fieldFrom2 = []
        let j = 0;
        let fieldColumnsArray2 = fieldColumnsArray.map((row) => {
            if (row.trim() != "") {
                return row;
            }
        }).filter(e => typeof e !== 'undefined');
        let fieldFromArray2 = fieldFromArray.map((row) => {
            if (row.trim() != "") {
                return row;
            }
        }).filter(e => typeof e !== 'undefined');

        // console.log("fieldColumnsArray", fieldColumnsArray);
        // console.log("fieldColumnsArray2", fieldColumnsArray2);
        // console.log("fieldFromArray2", fieldFromArray2);
        for (let i = 0; i < fieldColumnsArray2.length; i++) {
            if (i >= x) {
                x += tableLimit;
                j++;
            }
            if (fieldColumns2[j] != undefined) {
                fieldColumns2[j] += (" ," + fieldColumnsArray2[i]);
                fieldFrom2[j] += (" LEFT OUTER JOIN" + fieldFromArray2[i]);
            }
            else {
                fieldColumns2[j] = (fieldColumnsArray2[i]);
                fieldFrom2[j] = (" LEFT OUTER JOIN" + fieldFromArray2[i]);
            }
        }
        console.log("fieldColumnsArray2.length", fieldColumnsArray2.length);
        console.log("fieldColumns2", fieldColumns2);
        console.log("fieldFrom2", fieldFrom2);
        console.log("maxCount", maxCount);
        let query_result_array = [maxCount];
        let offset = 0; //offset = query offset starting from 0
        const limit = process.env.NUMBER_TO_DIVIDED_LINES; //limit = # of records get from db at a time 
        const limit1 = +limit + 1;

        //get data from db by chunk=10000 & total max records can get 50000
        let index = 1;
        while (offset < maxRecordsLimit) {
            console.time('test_sql');

            for (let i = 0; i < maxCount; i++) {
                let sql_data = '';
                console.log("------------------i", i);
                // 一周目
                if (i == 0) {
                    // 新  全てのユーザーデータを持ってくる
                    sql_data = `SELECT Customer.*, Reservation.* 
                        ${fieldColumns2[i] ? ', ' + fieldColumns2[i] : ''}
                        FROM Customer AS Customer
                        LEFT OUTER JOIN Reservation ON Customer.customerId = Reservation.customerId
                        LEFT OUTER JOIN Event ON Customer.eventId = Event.eventId
                        ${fieldFrom2[i] ? fieldFrom2[i] : ''}
                        ${fromQuery}
                        ${whereQuery}
                        ORDER BY 
                        Reservation.reservationEventCategoryId ASC
                        ,Reservation.reservationId ASC
                        ,Reservation.reservationReceiveDatetime ASC
                        ,Reservation.reservationEventInstituteName ASC
                        ,Reservation.reservationAcceptanceStartTimeFrom ASC
                        ,Reservation.reservationEventBusTime ASC
                        ,Reservation.reservationDatetime ASC
                        LIMIT ${offset}, ${limit1}
                    `;
                }
                else {
                    // 新  全てのユーザーデータを持ってくる
                    sql_data = `SELECT Reservation.reservationId 
                        ${fieldColumns2[i] ? ', ' + fieldColumns2[i] : ''}
                        FROM Customer AS Customer
                        LEFT OUTER JOIN Reservation ON Customer.customerId = Reservation.customerId
                        LEFT OUTER JOIN Event ON Customer.eventId = Event.eventId
                        ${fieldFrom2[i] ? fieldFrom2[i] : ''}
                        ${fromQuery}
                        ${whereQuery}
                        ORDER BY 
                        Reservation.reservationEventCategoryId ASC
                        ,Reservation.reservationId ASC
                        ,Reservation.reservationReceiveDatetime ASC
                        ,Reservation.reservationEventInstituteName ASC
                        ,Reservation.reservationAcceptanceStartTimeFrom ASC
                        ,Reservation.reservationEventBusTime ASC
                        ,Reservation.reservationDatetime ASC
                        LIMIT ${offset}, ${limit}
                    `;
                }
                console.log("sql_data----", sql_data);
                console.log("sql_data----projectId", projectId);
                const [query_result_data] = await mysql_con.query(sql_data, [projectId]);

                query_result_array[i] = query_result_data;
            }

            console.timeEnd('test_sql');

            let hasMoreAvailableRecords = false;
            if (query_result_array[0].length > limit) {
                query_result_array[0].pop();

                hasMoreAvailableRecords = true;
            }

            const recordsCount = query_result_array[0].length;

            //  console.time('test_generateTempFiles');
            //generate temp files
            if (recordsCount > 0) {
                const temFile = await generateTempFiles(index, query_result_array, maxCount, headerData, numberToDivideLines, csvExportTemplateColumn, itemAliasArr, filterQueryInfo, fieldInfo, encodePattern, listTypeFieldStyle);
                tmpFiles.push(temFile);
            }

            offset += recordsCount;

            if (offset >= maxRecordsLimit || !hasMoreAvailableRecords) break;

            index++;

            console.log('next offset', offset)
            //  console.timeEnd('test_generateTempFiles');
            // console.log('Loop Ended >>>>>>>>>>>>>>> : ');
        }

        // console.log('******************Finally Completed ************************')

        console.log('my tmpFiles ------------------->>>', tmpFiles)


        //Generate csv files from temFiles.
        if (tmpFiles.length > 0) {
            const output = fs.createWriteStream(filePath);
            // Create a PassThrough stream
            const passThroughStream = new stream.PassThrough();
            // Pipe the PassThrough stream to the output stream
            passThroughStream.pipe(output);
            // archiver object
            let archive = archiver('zip', { zlib: { level: 9 }, forceLocalTime: true });
            if (password && password !== '') {
                // create archive and specify method of encryption and password
                archive = archiver('zip-encryptable', { zlib: { level: 9 }, encryptionMethod: 'aes256', password: password, forceLocalTime: true });
            }

            archive.on('warning', function (err) {
                if (err.code === 'ENOENT') {
                    console.log('warning!');
                } else {
                    console.log(err);
                    throw err;
                }
            });
            // Good practice to catch this error explicitly
            archive.on('error', function (err) {
                console.log(err);
                throw err;
            });

            // Pipe the archive to the output stream
            archive.pipe(passThroughStream);

            // write stream to file
            const csvFileName = `${zipFileName}_${cYear + '-' + cMonth.substring(-2) + '-' + cDay.substring(-2) + '-' + cHours.substring(-2) + '-' + cMinutes.substring(-2) + '-' + cSeconds.substring(-2)}`;
            console.log('---------------------------2')
            tmpFiles.forEach((temFilePath, index) => {
                console.log('---------------------------3', index)
                archive.file(temFilePath, { name: `${csvFileName}_${(index + 1)}.csv` });
            });

            console.log('---------------------------0')
            // Finalize the archive
            archive.finalize();

            console.log('---------------------------1')
            const uploadFromStream2 = async (pass, path) => {
                const s3params = {
                    Bucket: BUCKET,
                    Key: path,
                    Body: pass,
                    ContentType: 'application/zip'
                };
                return s3.upload(s3params).promise()
            }

            //upload zip file in s3 bucket
            await uploadFromStream2(passThroughStream, filePath);
            console.log('---------------------------6')

            //update csvCount in mysql DB
            nowUnixtime = Math.floor(now / 1000);
            let sql_update = `UPDATE CSV SET csvPath = ?, csvCount = ?, updatedAt = ? WHERE csvId = ?;`;
            let param_update = [
                filePath,
                offset,
                nowUnixtime,
                query_result3.insertId
            ];
            console.log("sql_update:", sql_update);
            console.log("param_update:", param_update);
            console.log('---------------------------7')
            let [query_result_update] = await mysql_con.execute(sql_update, param_update);
        }
        //}

        mysql_con.commit();
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify('success'),
        };

    } catch (error) {
        // mysql_con.rollback();
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



    // time 4 digits spacifed here
    function leftPad(number, targetLength) {
        var output = number + '';
        while (output.length < targetLength) {
            output = '0' + output;
        }
        return output;
    };
    // text value formating
    function textFormat(value, formatMethod) {
        const inputValCount = value.length;
        const patternCount = (formatMethod.match(/@/g) || []).length;

        let formattedPattern = formatMethod;
        if (patternCount > inputValCount) {
            const index = formatMethod.split('@', inputValCount + 1).join('@').length;
            formattedPattern = formattedPattern.slice(0, index);
        }

        formattedPattern = formattedPattern.split('');

        let index = 0;
        formattedPattern = formattedPattern.map(c => {
            if (c == '@') {
                c = value.charAt(index);
                index++;
            }

            return c;
        });
        let formattedValue = formattedPattern.join('').replace(/-\s*$/, "");
        return formattedValue;
    };

    // list type field format apply
    function prepareListType(fieldId, val, formatMethod) {
        console.log(fieldId, 'fieldId');
        console.log(val, 'record list type');
        console.log(formatMethod, 'formatMethod');
        let targetQueryField = query_field_result.find(item => item.fieldId === fieldId);
        console.log(targetQueryField, 'targetQueryField');
        let inputTextArr = [];
        if (targetQueryField.fieldStyle.lookup.length > 0) {
            targetQueryField.fieldStyle.lookup.forEach(item => {
                if (val.includes(item.fieldListCode)) {
                    const value = item.inputBox2.value;
                    let formattedValue = textFormat(value, formatMethod);
                    inputTextArr.push(formattedValue);
                }
            });
        }

        let inputText = inputTextArr.toString();
        //console.log(inputText, 'inputText');
        return inputText;
    };

    async function generateTempFiles(index = 1, query_result_array = [], maxCount, headerData, numberToDivideLines, csvExportTemplateColumn, itemAliasArr, filterQueryInfo, fieldInfo, encodePattern, listTypeFieldStyle) {
        let query_result = [];
        let query_result2 = [];

        console.log('fieldInfo<<<<<<<>>>>>>', fieldInfo);
        console.time('test_query_result');


        //optimize the looping
        for (let i = 0; i < query_result_array[0].length; i++) {
            let row = query_result_array[0][i];
            for (let j = 1; j < maxCount; j++) {
                row = Object.assign(row, query_result_array[j][i]);
            }
            query_result.push(row);

            // if(i == 141) console.log('kkkkkkkkkkkkkkkkkkkkjjjj', row)
        }

        // for (let i = 0; i < query_result_array[0].length; i++) {
        //     let row = query_result_array[0][i];
        //     for (let j = 1; j < maxCount; j++) {
        //         row = {...row, ...query_result_array[j][i]};
        //     }
        //     query_result.push(row);
        // }
        console.timeEnd('test_query_result');

        //convert the data structire from array to object sothat the search & get data can be faster
        // hasanul修正後、ここには入らなくなるため以下不要 -----START
        /*let query_result2_obj = {};
        if (query_result2.length > 0) {
            const keyValuePairs = query_result2.map(item => [`${item.customerId}-${item.fieldId}`, item]);
            query_result2_obj = Object.fromEntries(keyValuePairs);
        }*/
        // hasanul修正後、ここには入らなくなるため以上不要 -----END

        const numberOfRows = query_result.length;

        let header = [headerData];

        // const utf16buffer = Buffer.from(`\ufeff${headerData}`, 'utf16le');
        // header = [utf16buffer]
        var i = 0;
        // Number of temporary lines when writing split files
        var tempRow = 0;

        // If there is a remainder in the quotient of the last line divided by the number of divided lines, increase the file by one and write the remainder
        const dividedFiles = numberOfRows % numberToDivideLines === 0 ? numberOfRows / numberToDivideLines : numberOfRows / numberToDivideLines + 1;
        // console.log(dividedFiles);
        console.log("numberOfRows", numberOfRows);

        if (numberOfRows !== 0 && query_result.length > 0) {
            // Loop for the number of divided files

            for (let i = 1; i <= 1; i += 1) {
                console.time('dividedFiles_result');

                // create a temporary file name
                const tmpFile = `/tmp/tmp_${index}.csv`;
                try {
                    let time = new Date();
                    time.setTime(time.getTime() + 1000 * 60 * 60 * 9);
                    fs.utimesSync(tmpFile, time, time);
                } catch {
                    // fs.closeSync(fs.openSync(tmpFile, 'w'));
                }
                // open sync temp file
                const fd = fs.openSync(tmpFile, "w");
                // Prepare write csv data
                let writeData = '';

                // console.log('my checking below >>')
                // console.log('my checking below >> query_result', query_result)
                // console.log('my checking below >> csvExportTemplateColumn', csvExportTemplateColumn)
                // console.log('my checking below >> itemAliasArr', itemAliasArr)

                for (let j = tempRow; j < numberOfRows && j < (i * numberToDivideLines); j++) {
                    ++tempRow;
                    let record = query_result[j];
                    console.log('record>>>>>>>>>>>>>>>', record);

                    if (typeof record !== undefined && record !== undefined) {
                        let newLine = [];

                        // for (var k = 0; k < itemAliasArr.length; k++) {
                        for (var k = 0; k < csvExportTemplateColumn.length; k++) {
                            let targetColumn = csvExportTemplateColumn[k];
                            let val = record[itemAliasArr[k]];

                            console.log('val>>>>>>>>>>>>>>>>>>>>', val);
                            // console.log('targetColumn>>>>>>>>>>>>>>>>>>>>', targetColumn);
                            // console.log('itemAlias>>>>>>>>>>>>>>>>>>>>', itemAliasArr[k]);

                            if (val && typeof val === 'string') val = val.trim();


                            // if (record.customerId == "153806" && targetColumn.fTypeId == 2261) {
                            // console.log("targetColumn", targetColumn);
                            // }
                            // console.log("xxx--------6", targetColumn);

                            // if (record.customerId == "153806" && targetColumn.fTypeId == 2261) {
                            //     console.log("val", val);
                            // }
                            // var val = convert.encode(record[itemAliasArr[k]], 'UTF16');
                            // var val = Buffer.from(`\ufeff${record[itemAliasArr[k]]}`, 'utf16le');
                            //console.log("========= val", val)

                            // if(j == 117) {
                            //     console.log('----------------record', record)
                            //     console.log('----------------val', val)
                            //     console.log('----------------itemAliasArr', itemAliasArr[k])
                            // }


                            //  if(j == 141) {
                            //      console.log('my records -----------------lopppppppp---------->>>>>>>>', record);  
                            //      console.log('my records -----------------lopppppppp---------->>>>>>>> targetColumn?.displayControl: ' + k, targetColumn?.displayControl);  
                            //      console.log('my records -----------------lopppppppp---------->>>>>>>> type: ', targetColumn);  
                            //      console.log('my records -----------------lopppppppp---------->>>>>>>> val: ', val);  
                            //  }

                            if (targetColumn?.displayControl === undefined || targetColumn?.displayControl == '0') {
                                // 値が存在しない
                                // hasanul修正後、ここには入らなくなるため以下不要 -----START
                                /*if (val === undefined) {
                                    const row = query_result2_obj[`${record.customerId}-${targetColumn.fTypeId}`];
                                    
                                    console.log(`before i am here ........-------------------------- ${j}`)

                                    if(row && row?.reservationNo) {
                                        console.log(`i am here ........-------------------------- ${j}`, row?.reservationNo)
                                    }

                                    if (row) {
                                        switch (targetColumn.inputBox.type) {
                                            case 0:
                                            case 1:
                                            case 2:
                                                val = row.customerFieldText;
                                                break;
                                            case 3:
                                                val = row.customerFieldList;
                                                break;
                                            case 4:
                                                val = row.customerFieldBoolean;
                                                break;
                                            case 5:
                                            case 6:
                                            case 7:
                                                val = row.customerFieldInt;
                                                break;
                                        }
                                        // if (record.customerId == "176") {
                                        //     console.log("val2", val);
                                        //     console.log("val3", row[0].customerFieldBoolean);
                                        // }
                                    }
                                }*/
                                // hasanul修正後、ここには入らなくなるため以上不要 -----END

                                // if(j == 141 && k == 5) {
                                //      console.log('my >>>>>>> type: ', targetColumn.inputBox.type);  
                                //      console.log('my >>>>>>> val: ', val);  
                                //  }

                                switch (targetColumn.inputBox.type) {
                                    case 0:
                                    case 1:
                                    case 2:
                                        // console.log('targetColumn.fieldFormat>>>>>>>>',targetColumn.fieldFormat);
                                        // console.log('finalValue1111>>>>>>>>',val);
                                        if (val && targetColumn.fieldFormat) {
                                            // val = '"'+textFormat(val, targetColumn.fieldFormat)+'"';
                                            val = textFormat(val, targetColumn.fieldFormat);
                                            console.log('finalValue>>>>>>>>', val);
                                            // console.log('record text, textarea & combine', val);
                                        }
                                        // 共済名出力
                                        if (targetColumn.fieldCode == 'd1b6bb78') {
                                            let receiveDate = new Date(record.reservationDatetime * 1000)
                                            let receiveDateFormat = format(receiveDate, "yyyy/M/d", { locale: ja })
                                            if (val == undefined || val == 'undefined') val = receiveDateFormat
                                            else val = receiveDateFormat + " " + val

                                            // val = receiveDateFormat + " " + (val == undefined || val == 'undefined')?"":val
                                            // console.log("targetColumn", val);
                                        }
                                        // if (record.customerId == "153806" && targetColumn.fTypeId == 2261) {
                                        //     console.log("val2", val);
                                        // }
                                        // newLine.push(val);
                                        break;
                                    case 3:
                                        // if (k == 19) {
                                        //     console.log('my val checking >>>>>>>>>>>>>> fieldQueryListData ', fieldQueryListData)
                                        //     console.log('my val checking >>>>>>>>>>>>>>', val)
                                        //     console.log('pppppppppppppppppppppppp----------', targetColumn)
                                        // }
                                        // console.log('fieldQueryListData>>>>>>>',fieldQueryListData);
                                        console.log('targetColumn>>>>>>>', JSON.stringify(targetColumn));
                                        let val2 = "";
                                        if (val !== undefined && val !== null) {
                                            //Identify val is Array of object or linear Array Ex: [{id: 1, checked: true}, {id: 3, checked: true}] or [233, 232, 3232, 3232]
                                            //If val = Array Object ([{id: 1, checked: true}, {id: 3, checked: true}]) then need to get name of equivalent id=1,3 then concatinate
                                            //If val = Linear Array ([233, 232, 3232, 3232]) then concatinate

                                            const isArrayObject = Array.isArray(val) && val.every(item => typeof item === 'object' && item !== null && !Array.isArray(item));

                                            if (isArrayObject && fieldQueryListData !== undefined && fieldQueryListData !== null) {
                                                for (let l = 0; l < fieldQueryListData.length; l++) {
                                                    // let fieldStyleLookup = fieldQueryListData[l].fieldStyle.lookup
                                                    // if (record.customerId == "168149") {
                                                    //     console.log("fieldStyleLookup1", fieldQueryListData[l]);
                                                    //     console.log("fieldStyleLookup2", fieldQueryListData[l].fieldStyle);
                                                    //     console.log("fieldStyleLookup3", fieldQueryListData[l].fieldStyle.lookup);
                                                    //     console.log("fieldStyleLookup3.length", fieldQueryListData[l].fieldStyle.lookup);
                                                    //     console.log("fieldStyleLookup4", fieldQueryListData[l].fieldStyle.lookup[0]);
                                                    // }

                                                    const { lookup: fieldStyleLookup, name: fieldStyleName } = fieldQueryListData[l]?.fieldStyle || {};

                                                    // console.log('targetColumn.fieldCode>>>>>>>',targetColumn.fieldCode);
                                                    // console.log('fieldStyleName.fieldStyleName>>>>>>>',fieldStyleName);

                                                    if (fieldStyleName == targetColumn.fieldCode) {
                                                        for (let m = 0; m < fieldStyleLookup.length; m++) {
                                                            // if (record.customerId == "168149") {
                                                            //     // console.log("val", val);
                                                            //     console.log("fieldStyleLookup[m].fieldListCode", fieldStyleLookup[m].fieldListCode);
                                                            //     console.log("val", val);
                                                            //     console.log("val.id", val.id);
                                                            //     // console.log("fieldQueryListData", JSON.stringify(fieldQueryListData));
                                                            // }
                                                            for (let n = 0; n < val.length; n++) {
                                                                let valueOfObject = val[n].hasOwnProperty('id') ? val[n].id : val[n];

                                                                if (fieldStyleLookup[m].fieldListCode == valueOfObject) {
                                                                    if (val2 == "") {
                                                                        val2 += fieldStyleLookup[m].inputBox2.value
                                                                    }
                                                                    else {
                                                                        val2 += "," + fieldStyleLookup[m].inputBox2.value
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                            else {
                                                //new for custom Field
                                                console.log('listTypeFieldStyle>>>>>>', JSON.stringify(listTypeFieldStyle));
                                                let fStyleList = listTypeFieldStyle && listTypeFieldStyle.length > 0 && listTypeFieldStyle.find(item => item.customFCode == targetColumn.fieldCode);

                                                if (fStyleList) {
                                                    const { lookup: fieldStyleLookups, name: fieldStyleNames } = fStyleList?.customFStle || {};
                                                    if (Array.isArray(val)) {
                                                        for (let n = 0; n < val.length; n++) {
                                                            let valueOfObject = val[n].hasOwnProperty('id') ? val[n].id : val[n];
                                                            let getValueFromLooksup = fieldStyleLookups && fieldStyleLookups.length > 0 && fieldStyleLookups.find(m => m.fieldListCode == valueOfObject);
                                                            console.log('getValueFromLooksup', JSON.stringify(getValueFromLooksup));

                                                            if (getValueFromLooksup) {
                                                                if (val2 == "") {
                                                                    val2 += getValueFromLooksup?.inputBox2?.value
                                                                }
                                                                else {
                                                                    val2 += "," + getValueFromLooksup?.inputBox2?.value
                                                                }
                                                            }
                                                        }

                                                    }

                                                } else {
                                                    val2 = Array.isArray(val) && val.join(',');
                                                }

                                            }
                                        }
                                        val = val2;
                                        // newLine.push(val2);
                                        break;
                                    case 4:
                                        // if (record.customerId == "177") {
                                        //     console.log("targetColumn.displayWhenNo", targetColumn.displayWhenNo);
                                        //     console.log("targetColumn.displayWhenYes", targetColumn.displayWhenYes);
                                        //     console.log("val", val);
                                        // }
                                        if (targetColumn.displayWhenNo || targetColumn.displayWhenYes) {
                                            switch (val) {
                                                case 0:
                                                    // newLine.push('"'+targetColumn.displayWhenNo+'"');
                                                    val = targetColumn.displayWhenNo;
                                                    break;
                                                case 1:
                                                    // newLine.push('"'+targetColumn.displayWhenYes+'"');
                                                    val = targetColumn.displayWhenYes;
                                                    break;
                                                default:
                                                    // newLine.push("");
                                                    val = "";
                                                    break;
                                            }
                                        }
                                        else {
                                            if (val === undefined) {
                                                // newLine.push("");
                                                val = "";
                                            }
                                            else {
                                                // newLine.push(val);
                                            }
                                        }
                                        break;
                                    case 5:
                                        // fieldformat exist
                                        if (val && targetColumn.fieldFormat) {
                                            val = format(new Date(val * 1000), targetColumn.fieldFormat);
                                        }
                                        // newLine.push(val);
                                        break;
                                    case 6:
                                        if (val !== null) {
                                            val = String(val);
                                        }
                                        switch (val && Number(targetColumn.fieldFormat)) {
                                            case 0:
                                                val = leftPad(val, 4);
                                                // console.log('time format type 0', val);
                                                // newLine.push(val);
                                                break;
                                            case 2:
                                                val = leftPad(val, 4);
                                                val = val.slice(-4, 2) + '時' + val.slice(-2) + '分';
                                                // console.log('time format type 2', val);
                                                // newLine.push(val);
                                                break;
                                            case 3:
                                                if (val.length == 4) {
                                                    val = val.slice(-4, 2) + '時' + val.slice(-2) + '分';
                                                }
                                                else if (val.length == 3) {
                                                    val = val.slice(-3, 1) + '時' + val.slice(-2) + '分';
                                                }
                                                else if (val.length == 1 || val.length == 2) {
                                                    val = 0 + '時' + val.slice(-2) + '分';
                                                }
                                                // console.log('time format type 3', val);
                                                // newLine.push(val);
                                                break;
                                            case 4:
                                                val = leftPad(val, 4);
                                                val = '午前' + val.slice(-4, 2) + '時' + val.slice(-2) + '分';
                                                // console.log('time format type 4', val);
                                                // newLine.push(val);
                                                break;
                                            case 5:
                                                if (val.length == 4) {
                                                    val = '午前' + val.slice(-4, 2) + '時' + val.slice(-2) + '分';
                                                }
                                                else if (val.length == 3) {
                                                    val = '午前' + val.slice(-3, 1) + '時' + val.slice(-2) + '分';
                                                }
                                                else if (val.length == 1 || val.length == 2) {
                                                    val = '午前' + 0 + '時' + val.slice(-2) + '分';
                                                }
                                                // console.log('time format type 5', val);
                                                // newLine.push(val);
                                                break;
                                            case 6:
                                                val = leftPad(val, 4);
                                                val = val.slice(-4, 2) + ':' + val.slice(-2);
                                                // console.log('time format type 6', val);
                                                // newLine.push(val);
                                                break;
                                            case 7:
                                                if (val.length == 4) {
                                                    val = val.slice(-4, 2) + ':' + val.slice(-2);
                                                }
                                                else if (val.length == 3) {
                                                    val = val.slice(-3, 1) + ':' + val.slice(-2);
                                                }
                                                else if (val.length == 1 || val.length == 2) {
                                                    val = 0 + ':' + val.slice(-2);
                                                }
                                                // console.log('time format type 7', val);
                                                // newLine.push(val);
                                                break;
                                            case 1:
                                            default:
                                                // console.log('time format type 1 & default', val);
                                                // newLine.push(val);
                                                break;
                                        }
                                        break;
                                    case 7:
                                        if (val !== null) {
                                            val = String(val);

                                            switch (Number(targetColumn.fieldFormat)) {
                                                case 1:
                                                    // newLine.push('"'+val.replace(/\B(?=(\d{3})+(?!\d))/g, ",")+'"');
                                                    val = val.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
                                                    break;
                                                case 2:
                                                    // newLine.push('"'+val.replace(/\B(?=(\d{3})+(?!\d))/g, ",")+'円"');
                                                    val = val.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + '円';
                                                    break;
                                                case 3:
                                                    // newLine.push('"¥'+val.replace(/\B(?=(\d{3})+(?!\d))/g, ",")+'"');
                                                    val = '¥' + val.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
                                                    break;
                                                case 0:
                                                default:
                                                    // newLine.push(val);
                                                    break;
                                            }
                                        } else {
                                            // newLine.push(val);
                                            val = '';
                                        }
                                        break;
                                } // end switch

                                //FIXME: 暫定処置 nullまたはundefinedにならないようにする
                                if (val === null || val === undefined || val === "undefined") {
                                    newLine.push("");
                                } else {
                                    // カンマ区切り対策にダブルクォーテーションで挟み込む
                                    if (String(val).indexOf(',') !== -1) {
                                        newLine.push('"' + String(val).replace(/\r\n|\r|\n/g, ' ') + '"');
                                    }
                                    else {
                                        newLine.push(String(val).replace(/\r\n|\r|\n/g, ' '));
                                    }
                                }
                            }
                            // カスタム値
                            // 条件にマッチした値を出力
                            else if (targetColumn?.displayControl == "1") {
                                let addFlag = false;
                                console.log("targetColumn",targetColumn);
                                if(targetColumn.hasOwnProperty('innerDrag')){
                                    let targetColumnOrder = targetColumn.innerDrag.sort(function (row1, row2) {
                                        if (row1.currentPos < row2.currentPos) return -1;
                                        if (row1.currentPos > row2.currentPos) return 1;
                                    });


                                    loop1:
                                    // for (let x = 0; x < targetColumn.innerDrag.length; x++) {
                                    for (let x = 0; x < targetColumnOrder.length; x++) {
                                        // if (record.customerId == "69363" && targetColumn.fTypeId == 2075) {
                                        //     console.log("targetColumn.innerDrag 1");
                                        // }
                                        for (let y = 0; y < filterQueryInfo.length; y++) {
                                            // if (record.customerId == "69363" && targetColumn.fTypeId == 2075) {
                                            //     console.log("targetColumn.innerDrag 2", targetColumn.innerDrag[x].fTypeId);
                                            //     console.log("targetColumn.innerDrag 2", filterQueryInfo[y].filterId);
                                            // }
                                            if (targetColumnOrder[x].fTypeId == filterQueryInfo[y].filterId) {
                                                // if (record.customerId == "69363" && targetColumn.fTypeId == 2075) {
                                                //     console.log("filterQuery", filterQueryInfo[y].filterQuery);
                                                //     console.log("record", record);
                                                //     console.log("filterQueryInfo[y].filterId", filterQueryInfo[y].filterId);
                                                //     console.log("record ab9022db", record["orgField_ab9022db"]);
                                                //     console.log("record 9d374129", record["orgField_9d374129"]);
                                                // }




                                                // if(j == 142) {
                                                //     // console.log('my checking -------2222222222----------->>>> result', commonFunctions2.getUserDataFromFilter(filterQueryInfo[y].filterQuery, record, fieldInfo, val));

                                                //     console.log('kppppppppppp', filterQueryInfo[y].filterQuery)
                                                //     console.log('m ----------------------> record', record)
                                                //     console.log('m ----------------------> val', val)
                                                // }

                                                let isFilter = commonFunctions2.getUserDataFromFilter(filterQueryInfo[y].filterQuery, record, fieldInfo, val);
                                                console.log('isFilter', isFilter);
                                                if (isFilter) {
                                                    // if (record.customerId == "69363" && targetColumn.fTypeId == 2075) {
                                                    //     console.log("checkFilter result", commonFunctions2.getUserDataFromFilter(filterQueryInfo[y].filterQuery, record, fieldInfo));
                                                    //     console.log("targetColumn", targetColumn);
                                                    //     console.log("targetColumn.innerDrag[x]", targetColumn.innerDrag[x]);
                                                    //     console.log("targetColumn.innerDrag[x].inputBox3", targetColumn.innerDrag[x].inputBox3);
                                                    // }
                                                    addFlag = true;
                                                    // if (record.customerId == "215052" && targetColumn.fTypeId == 2075) {
                                                    //     console.log("result filter", filterQueryInfo[y].filterQuery);
                                                    //     console.log("result value", String(targetColumn.innerDrag[x].inputBox3.value).replace(/\r\n|\r|\n/g, ' '));
                                                    // }
                                                    newLine.push(String(targetColumnOrder[x].inputBox3.value).replace(/\r\n|\r|\n/g, ' '));
                                                    break loop1;
                                                    // return targetColumn.innerDrag[x].inputBox3.value
                                                }
                                            }
                                        }
                                    }
                                }
                                if (!addFlag) {
                                    newLine.push("");
                                }

                            }
                            // 集合値
                            // タグボックスの値の合計を出力
                            else if (targetColumn?.displayControl == "2") {
                                let sumValue = 0;

                                if (targetColumn.tagBoxValue !== undefined && targetColumn.tagBoxValue.length >= 1) {
                                    const targetFieldIds = targetColumn.tagBoxValue || [];
                                    let customerIds = query_result_array[0].map(x => x.customerId);

                                    if (customerIds.length > 0 && targetFieldIds.length > 0) {
                                        let sql_data2 = `SELECT * FROM CustomerField WHERE customerId IN (?) AND fieldId IN (?)`;

                                        [query_result2] = await mysql_con.query(sql_data2, [customerIds, targetFieldIds]);
                                    }

                                    //  console.log('my checking ->>>>>>>>>>>>>>>>>>> (2)', query_result2)
                                    //  console.log('my checking ->>>>>>>>>>>>>>>>>>> (2) >>>>>', targetColumn.tagBoxValue)

                                    for (let y = 0; y < query_result2.length; y++) {
                                        let row = query_result2[y];
                                        for (let x = 0; x < targetColumn.tagBoxValue.length; x++) {
                                            let sumFieldId = targetColumn.tagBoxValue[x];

                                            if (row.customerId == record.customerId && row.fieldId == sumFieldId) {
                                                if (row.customerFieldInt != null) {
                                                    sumValue = sumValue + Number(row.customerFieldInt);
                                                }
                                                else if (row.customerFieldBoolean != null) {
                                                    sumValue = sumValue + Number(row.customerFieldBoolean);
                                                }
                                                else {
                                                    sumValue = sumValue + 0;
                                                }
                                            }
                                        }
                                    }
                                }
                                newLine.push(sumValue);
                            }
                            // 全角から半角に変換
                            else if (targetColumn?.displayControl == "3") {
                                // if (record.customerId == "167064") {
                                //     console.log("targetColumn.innerDrag", targetColumn);
                                //     console.log("val", val);
                                //     console.log("val2", await commonFunctions3.changeCharacterHalf(val));
                                // }
                                newLine.push(await commonFunctions3.changeCharacterHalf(val));
                            }
                            // 半角から全角に変換
                            else if (targetColumn?.displayControl == "4") {
                                // console.log("targetColumn.innerDrag", targetColumn.innerDrag);
                                newLine.push(await commonFunctions4.changeCharacterFull(val));
                            }
                        }

                        // if (record.customerId == "176") {
                        //     console.log("newLine", newLine);
                        // } 
                        // add row data
                        writeData += '\n' + newLine.join(',');

                        // if(j == 141) {
                        //             console.log('my checking ------------------>>>>', newLine)
                        // }
                    }
                } // end for numberOfRows

                // console.log('my write data --------------------->>>>', writeData)

                // add header data
                writeData = header.join(',') + writeData;

                if (encodePattern === 0) {
                    // add BOM (byte order mark)
                    writeData = '\ufeff' + writeData;
                }

                // convert to Shift-JIS
                if (encodePattern === 2) {
                    // Convert string to code array
                    const unicodeArray = encoding.stringToCode(writeData);
                    // const sjisArray = encoding.convert(unicodeArray, { to: 'SJIS', from: 'UNICODE' });
                    // fs.writeSync(fd, Buffer.from(sjisArray));

                    const chunkSize = 5000;
                    for (let i = 0; i < unicodeArray.length; i += chunkSize) {
                        const chunkArr = unicodeArray.slice(i, i + chunkSize);
                        const sjisArray = encoding.convert(chunkArr, { to: 'SJIS', from: 'UNICODE' });

                        fs.writeSync(fd, Buffer.from(sjisArray));
                    }
                }
                else {
                    fs.writeSync(fd, writeData);
                }
                // close sync write file
                fs.closeSync(fd);
                // Keep Temporary File Path
                // tmpFiles.push(tmpFile);
                console.timeEnd('dividedFiles_result');

                // console.log('my write data ----------------', writeData + '<<<<<<<<$$$$$$$$$>>>>>>>');

                return tmpFile;
            }
        }
        else {
            // If there are no reservation records, a header-only CSV file will be created and exit.
            console.log('no reservation record only header!!');
            // create a temporary file name
            const tmpFile = `/tmp/tmp_${i}.csv`;
            // Prepare write csv data
            let writeData = '';
            if (encodePattern === 0) {
                // add BOM (byte order mark)
                writeData += '\ufeff';
            }
            // add header data
            writeData += header.join(',') + '\n';
            // open sync temp file
            const fd = fs.openSync(tmpFile, "w");
            // convert to Shift-JIS
            if (encodePattern === 2) {
                // Convert string to code array
                const unicodeArray = encoding.stringToCode(writeData);
                // const sjisArray = encoding.convert(unicodeArray, { to: 'SJIS', from: 'UNICODE' });
                // fs.writeSync(fd, Buffer.from(sjisArray));

                //formatting japaneese lng by using chunk=5000
                const chunkSize = 5000;
                for (let i = 0; i < unicodeArray.length; i += chunkSize) {
                    const chunkArr = unicodeArray.slice(i, i + chunkSize);
                    const sjisArray = encoding.convert(chunkArr, { to: 'SJIS', from: 'UNICODE' });

                    fs.writeSync(fd, Buffer.from(sjisArray));
                }
            }
            else {
                fs.writeSync(fd, writeData);
            }
            // close sync write file
            fs.closeSync(fd);
            // Keep Temporary File Path
            // tmpFiles.push(tmpFile);
            return tmpFile;
        }
    }
};