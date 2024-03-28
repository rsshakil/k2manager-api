
/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
 const AWS = require('aws-sdk')
 const mysql = require("mysql2/promise");
 const ssm = new AWS.SSM();
 const commonFunctions = require('./commonFunctions/getWhereFromFilter')
 process.env.TZ = 'Asia/Tokyo';

/**
 * ManagerCustomerViewRead.
 * 
 * @param {*} event
 * @returns {json} response
 */
 exports.handler = async (event) => {
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
    let mysql_con;
    const readDbConfig = {
        host: process.env.DBREADENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE, 
        charset: process.env.DBCHARSET
    };
    // console.log(event);
    // mysql connect
    mysql_con = await mysql.createConnection(readDbConfig);
    if (event.queryStringParameters !== null) {
        // Expand POST parameters 
        //  let jsonBody = JSON.parse(event.body);
        let jsonBody = event.queryStringParameters;
        let projectId = 0;
        if (jsonBody?.pid) {
            projectId = jsonBody.pid;
        } else {
            let error = "invalid parameter. Project ID not found.";
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(error),
            };
        }
        let validProjectId;
        if (event?.requestContext?.authorizer?.pid) {
            validProjectId = JSON.parse(event?.requestContext?.authorizer?.pid)
            // pidがない場合　もしくは　許可プロジェクトIDに含まれていない場合
            if (!projectId || validProjectId.indexOf(Number(projectId)) == -1) {
                return {
                    statusCode: 403,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': '*',
                    },
                    body: JSON.stringify("Unauthorized"),
                }
            }
        }

        console.log("event.requestContext", event?.requestContext);
        console.log("event.requestContext.authorizer", event?.requestContext?.authorizer);
        console.log("event.requestContext.authorizer.pid", event?.requestContext?.authorizer?.pid);
        console.log("event.requestContext.authorizer.authRole", event?.requestContext?.authorizer?.authRole);
/*
        let beforeSqlCustomer = `SELECT Customer.*,Reservation.reservationNo,f1.reservationNo as r1,f2.reservationNo as r2,f3.reservationNo as r3,f1.customerFieldList AS s9, f2.customerFieldText AS s10, CASE WHEN f3.customerFieldBoolean is null then '' WHEN f3.customerFieldBoolean = 1 THEN '同意する' ELSE '同意しない' END AS s11 FROM Customer 
        LEFT OUTER JOIN Reservation ON Customer.customerId = Reservation.customerId
            LEFT OUTER JOIN Event ON Customer.eventId = Event.eventId
             LEFT OUTER JOIN CustomerField AS f1 ON Customer.customerId = f1.customerId AND f1.fieldId = 2329 AND Reservation.reservationNo = f1.reservationNo LEFT OUTER JOIN CustomerField AS f2 ON Customer.customerId = f2.customerId AND f2.fieldId = 2327 AND Reservation.reservationNo = f2.reservationNo LEFT OUTER JOIN CustomerField AS f3 ON Customer.customerId = f3.customerId AND f3.fieldId = 1869 AND Reservation.reservationNo = f3.reservationNo 
             LEFT OUTER JOIN CustomerField AS w1 ON Customer.customerId = w1.customerId AND w1.fieldId = 2329 AND Reservation.reservationNo = w1.reservationNo LEFT OUTER JOIN CustomerField AS w2 ON Customer.customerId = w2.customerId AND w2.fieldId = 2327 AND Reservation.reservationNo = w2.reservationNo LEFT OUTER JOIN CustomerField AS w3 ON Customer.customerId = w3.customerId AND w3.fieldId = 1869 AND Reservation.reservationNo = w3.reservationNo
             WHERE Customer.customerId = ?
             `;
        let testsql = `SELECT
        null AS s0, null AS s1, null AS s2, Customer.eventCategoryId AS s3, Customer.eventInstituteId AS s4, Reservation.reservationCounselorId AS s5, Reservation.reservationItemSlotId AS s6, FORMAT(Reservation.reservationItem, 0) AS s7, FORMAT(Reservation.reservationItemId, 0) AS s8, f1.customerFieldList AS s9, f2.customerFieldText AS s10, CASE WHEN f3.customerFieldBoolean is null then '' WHEN f3.customerFieldBoolean = 1 THEN '同意する' ELSE '同意しない' END AS s11
        , Customer.customerId, Customer.token1, Customer.token2, Customer.token3, Reservation.reservationId, Reservation.reservationNo, Event.eventId, Event.eventMailFlag, Reservation.reservationStatus, Reservation.reservationEventCategoryId AS eventCategoryId
        FROM Customer AS Customer
        LEFT OUTER JOIN Reservation ON Customer.customerId = Reservation.customerId
        LEFT OUTER JOIN Event ON Customer.eventId = Event.eventId
         LEFT OUTER JOIN CustomerField AS f1 ON Customer.customerId = f1.customerId AND f1.fieldId = 2329 AND Reservation.reservationNo = f1.reservationNo LEFT OUTER JOIN CustomerField AS f2 ON Customer.customerId = f2.customerId AND f2.fieldId = 2327 AND Reservation.reservationNo = f2.reservationNo LEFT OUTER JOIN CustomerField AS f3 ON Customer.customerId = f3.customerId AND f3.fieldId = 1869 AND Reservation.reservationNo = f3.reservationNo 
         LEFT OUTER JOIN CustomerField AS w1 ON Customer.customerId = w1.customerId AND w1.fieldId = 2329 AND Reservation.reservationNo = w1.reservationNo LEFT OUTER JOIN CustomerField AS w2 ON Customer.customerId = w2.customerId AND w2.fieldId = 2327 AND Reservation.reservationNo = w2.reservationNo LEFT OUTER JOIN CustomerField AS w3 ON Customer.customerId = w3.customerId AND w3.fieldId = 1869 AND Reservation.reservationNo = w3.reservationNo
        WHERE Customer.customerId = ?`;
        let [beforeResultCustomer] = await mysql_con.execute(beforeSqlCustomer, [1]);
        console.log('beforeResultCustomer',beforeResultCustomer[0]);
        let [beforeResultCustomer2] = await mysql_con.execute(testsql, [1]);
        console.log('beforeResultCustomer2',beforeResultCustomer2[0]);
*/
        if (projectId != 0) {
            let pagesVisited = (jsonBody?.pagesVisited || jsonBody?.pagesVisited == 0) ? jsonBody?.pagesVisited : 0;
            let itemsPerPage = (jsonBody?.itemsPerPage || jsonBody?.itemsPerPage == 0) ? jsonBody?.itemsPerPage : 500;
            // Other search query ( roleId , accountName)
            let parameter = [];
            let whereQuery = "";
            let orderBy = "";
            whereQuery += ` AND Event.projectId = ?`;
            parameter.push(Number(projectId));

            let authrole = [];
            for (let i = 0; i < event?.requestContext?.authorizer?.authRole.length; i++) {
                authrole[i] = event?.requestContext?.authorizer?.authRole.charAt(i)
            }
            console.log("authrole", authrole);
            // template id
            var queryField = 'Customer.*,Reservation.*';
            var queryFrom = '';
            var templatefieldList = [];
            let whereQuery2 = "";
            let queryFrom2 = "";
            let customFieldFrom = "";
            var fieldQueryListData;
            var fieldQueryListData2;
            if (jsonBody.templateId) {
                //get templateInfo
                try {
                    const sql_dataTemplate = 
                    `SELECT 
                        customerViewTemplateQuery,customerViewTemplateMaskQuery,customerViewTemplateOrder,
                        customerViewTemplateSearch,customerViewTemplateFrom, Filter.filterId, Filter.filterQuery, customerViewTemplateListData
                    FROM 
                        CustomerViewTemplate LEFT JOIN Filter ON CustomerViewTemplate.filterId = Filter.filterId
                    WHERE CustomerViewTemplate.customerViewTemplateId = ?`
                    var [query_result_template] = await mysql_con.query(sql_dataTemplate, [jsonBody.templateId]);
                    if(query_result_template[0]){
                        let customerViewTemplateQuery = (authrole[7] == "2")? query_result_template[0].customerViewTemplateMaskQuery:query_result_template[0].customerViewTemplateQuery;
                        let customerViewTemplateOrder = query_result_template[0].customerViewTemplateOrder;
                        let customerViewTemplateSearch = query_result_template[0].customerViewTemplateSearch;
                        let customerViewTemplateListData = query_result_template[0].customerViewTemplateListData;
                        queryField = customerViewTemplateQuery;
                        console.log('customerViewTemplateFrom',query_result_template[0].customerViewTemplateFrom);

                        queryFrom = query_result_template[0].customerViewTemplateFrom??'';
                        if(customerViewTemplateOrder!=''){
                            orderBy = `ORDER BY ${customerViewTemplateOrder}`;
                        }
                        /*search query start*/
                        console.log('queryField',queryField);
                        console.log('jsonBody',jsonBody);
                        console.log('customerViewTemplateSearch',customerViewTemplateSearch);

                        if(customerViewTemplateSearch && customerViewTemplateSearch.length>0){
                            // fieldData
                            let numOfField = 1;
                            customerViewTemplateSearch.map(item=>{
                                let fieldInfo = item.fieldData;
                                // console.log('searchField',fieldInfo.fieldColumnName);
                                console.log('fieldInfo.fieldType',fieldInfo);
                                // console.log('corresPondingsearchField',jsonBody[fieldInfo.fieldColumnName]);
                                if(jsonBody[fieldInfo.fieldCode] && typeof jsonBody[fieldInfo.fieldCode]!='undefined' && jsonBody[fieldInfo.fieldCode]!=''){
                                    if(fieldInfo.fieldType!=3 && fieldInfo.fieldType!=4 && fieldInfo.fieldType!=8 && fieldInfo.fieldType!=5 && fieldInfo.fieldType!=6){
                                        let queryValue = jsonBody[fieldInfo.fieldCode];
                                        //new condition applied by sakil 07/27/23 for whitespace & case insensetive
                                        queryValue = queryValue.trim();
                                        queryValue = queryValue.toLowerCase();
                                        if (queryValue.slice(0, 1) != '*' && queryValue.slice(-1) != '*') {
                                            console.log('whreeINSEARCHIN RESERVATION111',jsonBody[fieldInfo.fieldCode]);
                                            whereQuery += ` AND LOWER(${fieldInfo.fieldColumnName}) = ?`;
                                            parameter.push(queryValue);
                                        } else {
                                            console.log('whreeINSEARCHIN RESERVATION222',jsonBody[fieldInfo.fieldCode]);
                                            whereQuery += ` AND LOWER(${fieldInfo.fieldColumnName}) like ?`;
                                            parameter.push(queryValue.replace(/(^\*)|(\*$)/g, '%'));
                                        }
                                        // whereQuery += ` AND ${fieldInfo.fieldColumnName} like ?`;
                                        // parameter.push("%" + jsonBody[fieldInfo.fieldColumnName] + "%");
                                    }else{
                                        console.log('whreeINSEARCHIN RESERVATION333',jsonBody[fieldInfo.fieldCode]);
                                        if(fieldInfo.fieldType==8){
                                            if (fieldInfo.fieldCode == "00000a21") {
                                                whereQuery += ` AND ${fieldInfo.fieldColumnName} IN (?)`;
                                                let whereInValues = jsonBody[fieldInfo.fieldCode].includes(",")?jsonBody[fieldInfo.fieldCode].split(","):Number(jsonBody[fieldInfo.fieldCode]);
                                                parameter.push(whereInValues);
                                            }
                                            else if (fieldInfo.fieldCode == "00000a22") {
                                                whereQuery += ` AND ${fieldInfo.fieldColumnName} IN (?)`;
                                                let whereInValues = jsonBody[fieldInfo.fieldCode].includes(",")?jsonBody[fieldInfo.fieldCode].split(","):Number(jsonBody[fieldInfo.fieldCode]);
                                                parameter.push(whereInValues);
                                            }
                                            else if (fieldInfo.fieldCode == "00000a23") {
                                                whereQuery += `
                                                    AND (JSON_CONTAINS(${fieldInfo.fieldColumnName}, '?', '$' ) 
                                                        OR (
                                                            JSON_EXTRACT(${fieldInfo.fieldColumnName}, '$') = JSON_ARRAY()
                                                        )
                                                    )`;
                                                let whereInValues = jsonBody[fieldInfo.fieldCode].includes(",")?jsonBody[fieldInfo.fieldCode].split(","):Number(jsonBody[fieldInfo.fieldCode]);
                                                parameter.push(whereInValues);
                                            }
                                            else if (fieldInfo.fieldCode == "00000a24") {
                                                whereQuery += `
                                                    AND (JSON_CONTAINS(${fieldInfo.fieldColumnName}, '?', '$' ) 
                                                        OR (
                                                            JSON_EXTRACT(${fieldInfo.fieldColumnName}, '$') = JSON_ARRAY()
                                                        )
                                                    )`;
                                                let whereInValues = jsonBody[fieldInfo.fieldCode].includes(",")?jsonBody[fieldInfo.fieldCode].split(","):Number(jsonBody[fieldInfo.fieldCode]);
                                                parameter.push(whereInValues);
                                            }
                                            else if (fieldInfo.fieldCode == "00000a25") {
                                                whereQuery += ` AND ${fieldInfo.fieldColumnName} IN (?)`;
                                                let whereInValues = jsonBody[fieldInfo.fieldCode].includes(",")?jsonBody[fieldInfo.fieldCode].split(","):Number(jsonBody[fieldInfo.fieldCode]);
                                                parameter.push(whereInValues);
                                            }
                                        }else if(fieldInfo?.fieldType==5){
                                            if(jsonBody[fieldInfo?.fieldCode]!='undefined'){
                                                // whereQuery += ` AND DATE_FORMAT(from_unixtime(${fieldInfo?.fieldColumnName}), '%Y/%m/%d') = ?`;
                                                whereQuery += ` AND DATE_FORMAT(DATE_ADD(FROM_UNIXTIME(0), INTERVAL ${fieldInfo?.fieldColumnName} SECOND),'%Y/%m/%d') = ?`;
                                                parameter.push(jsonBody[fieldInfo?.fieldCode]);
                                            }
                                        }else if(fieldInfo?.fieldType==6){
                                            if(jsonBody[fieldInfo?.fieldCode]!='undefined'){
                                                // whereQuery += ` AND DATE_FORMAT(from_unixtime(${fieldInfo?.fieldColumnName}), '%Y/%m/%d') = ?`;
                                                whereQuery += ` AND ${fieldInfo?.fieldColumnName} = ?`;
                                                let timeOnly = new Date(+jsonBody[fieldInfo?.fieldCode]);
                                                let getTimeHour = timeOnly.getHours() > 0 ? timeOnly.getHours() : '';
                                                let getTimeMin = timeOnly.getMinutes();
                                                getTimeMin = getTimeMin < 10 ? `0${getTimeMin}` : getTimeMin;
                                                let timeValue = `${getTimeHour}${getTimeMin}`;
                                                console.log('search by time',timeValue);
                                                parameter.push(timeValue);
                                            }
                                        } else if (fieldInfo?.fieldType == 3) { 
                                           
                                            
                                            whereQuery += ` AND JSON_CONTAINS(JSON_EXTRACT(${fieldInfo.fieldColumnName}, '$[*].id'), ?, '$')`;
                                            let whereVal = `"${jsonBody[fieldInfo?.fieldCode]}"`;
                                            console.log('list type search query',whereVal); 
                                            parameter.push(whereVal);
                                        } else {
                                            //new condition applied by sakil 07/27/23 for whitespace & case insensetive
                                            let queryValue = jsonBody[fieldInfo.fieldCode];
                                            queryValue = queryValue.trim();
                                            queryValue = queryValue.toLowerCase();
                                            if (queryValue.slice(0, 1) != '*' && queryValue.slice(-1) != '*') {
                                                whereQuery += ` AND LOWER(${fieldInfo.fieldColumnName}) = ?`;
                                                parameter.push(queryValue);
                                            } else { 
                                                whereQuery += ` AND LOWER(${fieldInfo.fieldColumnName}) like ?`;
                                                parameter.push(queryValue.replace(/(^\*)|(\*$)/g, '%'));
                                            }
                                        }
                                        
                                    }
                                    
                                }else if(fieldInfo?.projectId!=0){
                                    //its customerField search
                                    // console.log('CustomerFieldSearchField11111')
                                    let fName = '';
                                    switch (fieldInfo?.fieldType) {
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
                                    console.log('CustomerFieldSearchField',jsonBody[`f${numOfField}.${fName}`]);
                                    if(jsonBody[`f${numOfField}.${fName}`] && typeof jsonBody[`f${numOfField}.${fName}`]!='undefined' && jsonBody[`f${numOfField}.${fName}`]!=''){
                                        if (fieldInfo?.fieldType == 3) {
                                            // whereQuery += ` AND w${numOfField}.${fName} IN(?)`;
                                            whereQuery += ` AND (JSON_CONTAINS(w${numOfField}.${fName}, ?, '$') OR w${numOfField}.${fName} LIKE ?)`;
                                            let whereVal1 = `"${jsonBody[`f${numOfField}.${fName}`]}"`;
                                            parameter.push(whereVal1);
                                            whereVal1 = `%"${jsonBody[`f${numOfField}.${fName}`]}"%`;
                                            parameter.push(whereVal1);
                                        } else if (fieldInfo?.fieldType == 5) {
                                            if(jsonBody[`f${numOfField}.${fName}`]!='undefined'){
                                                // whereQuery += ` AND DATE_FORMAT(from_unixtime(${fieldInfo?.fieldColumnName}), '%Y/%m/%d') = ?`;
                                                whereQuery += ` AND DATE_FORMAT(DATE_ADD(FROM_UNIXTIME(0), INTERVAL f${numOfField}.${fName} SECOND),'%Y/%m/%d') = ?`;
                                                parameter.push(jsonBody[`f${numOfField}.${fName}`]);
                                            }
                                         } else if (fieldInfo?.fieldType == 6) {
                                            if(jsonBody[`f${numOfField}.${fName}`]!='undefined'){
                                                // whereQuery += ` AND DATE_FORMAT(from_unixtime(${fieldInfo?.fieldColumnName}), '%Y/%m/%d') = ?`;
                                                whereQuery += ` AND w${numOfField}.${fName} = ?`;
                                                let timeOnly = new Date(+jsonBody[`f${numOfField}.${fName}`]);
                                                let getTimeHour = timeOnly.getHours() > 0 ? timeOnly.getHours() : '';
                                                let getTimeMin = timeOnly.getMinutes();
                                                getTimeMin = getTimeMin < 10 ? `0${getTimeMin}` : getTimeMin;
                                                
                                                let timeValue = `${getTimeHour}${getTimeMin}`;
                                                console.log('search by time',timeValue);
                                                parameter.push(timeValue);
                                            }
                                         } else { 
                                            whereQuery += ` AND w${numOfField}.${fName} = ?`;
                                            parameter.push(jsonBody[`f${numOfField}.${fName}`]);
                                        }
                                        
                                    }
                                    customFieldFrom += ` LEFT OUTER JOIN CustomerField AS w${numOfField} ON Customer.customerId = w${numOfField}.customerId AND w${numOfField}.fieldId = ${fieldInfo?.fieldId} AND (CASE WHEN Reservation.reservationNo IS NULL THEN '' ELSE Reservation.reservationNo END) = w${numOfField}.reservationNo`;
                                    numOfField++;    
                                }
                            })
                        }
                        // 条件があるかどうか？
                        if (query_result_template[0].filterId >= 1) {
                            console.log("filterData --- 1", query_result_template[0].filterQuery);
                            let queryArray = await commonFunctions.getWhereFromFilter(mysql_con, query_result_template[0].filterQuery)
                            queryFrom2 = queryArray[0]??'';
                            whereQuery2 += queryArray[1]??'';
                        }

                        // リストデータがあるかどうか？
                        if (customerViewTemplateListData != null && Array.isArray(customerViewTemplateListData) && customerViewTemplateListData.length >= 1) {
                            let fieldCode = [];
                            for (let i = 0; i < customerViewTemplateListData.length; i++) {
                                let row = customerViewTemplateListData[i];
                                fieldCode.push(row.fieldCode);
                            }
                            let fieldQuery = `SELECT fieldStyle FROM Field WHERE fieldCode IN (?)`;
                            [fieldQueryListData] = await mysql_con.query(fieldQuery, [fieldCode]);
                            fieldQueryListData2 = [];
                            for(let k = 0; k < fieldCode.length; k++) {
                                let rowData;
                                queryTable: for (let i = 0; i < fieldQueryListData.length; i++) {
                                    for (let j = 0; j < customerViewTemplateListData.length; j++) {
                                        // console.log("fieldQueryListData", fieldQueryListData[i].fieldStyle);
                                        if (fieldQueryListData[i].fieldStyle != null && fieldQueryListData[i].fieldStyle.name == customerViewTemplateListData[j].fieldCode && !customerViewTemplateListData[j].enabled) {
                                            fieldQueryListData[i].fieldStyle.columnCode = customerViewTemplateListData[j].numOfField;
                                            customerViewTemplateListData[j].enabled = true;
                                            // fieldQueryListData2[k].fieldStyle.columnCode = customerViewTemplateListData[j].numOfField;
                                            rowData = JSON.parse(JSON.stringify(fieldQueryListData[i]));
                                            break queryTable;
                                        }
                                    }
                                }
                                if (rowData) {
                                    fieldQueryListData2.push(rowData);
                                }
                            }
                        }
                    }

                    /*search query end*/
/*
                    let templateParam = [];
                    const sql_dataTemplate = `SELECT * FROM CustomerViewTemplate WHERE CustomerViewTemplate.customerViewTemplateId = ? AND CustomerViewTemplate.projectId = ?`
                    templateParam.push(Number(jsonBody.templateId));
                    templateParam.push(Number(projectId));
                    var [query_result_template, query_field_template] = await mysql_con.query(sql_dataTemplate, templateParam);
                
                    if(query_result_template){
                        let customerViewTemplateItemList = query_result_template[0].customerViewTemplateColumn;
                        let fieldIdArrays = customerViewTemplateItemList.map(item => {
                            if(item.customerTemplate.fieldType>0){
                                return {position:item.currentPos,fieldId:item.customerTemplate.fieldType}
                            }
                        })
                        fieldIdArrays.sort((a,b)=> (a.position > b.position ? 1 : -1));
                        let fieldIdArray = fieldIdArrays.map(item => {
                            if(item.fieldId>0){
                                return item.fieldId
                            }
                        })
                       
                        let fieldQueryParam = [];
                        //get field list
                        const sql_data_fields = `SELECT * FROM Field WHERE 1=1 AND fieldId IN (?) AND (projectId = 0 OR projectId = ?) ORDER BY Field.fieldId ASC`
                        fieldQueryParam.push(fieldIdArray);
                        fieldQueryParam.push(Number(projectId));
                        let [query_result_field_name, query_fields_field] = await mysql_con.query(sql_data_fields, fieldQueryParam);

                        templatefieldList = query_result_field_name;
                        let fieldIdArrayList = fieldIdArrays.map(item => {
                            return templatefieldList.find(fieldRow=>fieldRow.fieldId==item.fieldId);
                        })
                        
                        let fieldNameArray = fieldIdArrayList.map(item => {
                            return item.fieldColumnName
                        })
                        queryField = fieldNameArray.join(', '); 
                        // return {
                        //     statusCode: 200,
                        //     headers: {
                        //         'Access-Control-Allow-Origin': '*',
                        //         'Access-Control-Allow-Headers': '*',
                        //     },
                        //     body: JSON.stringify(fieldIdArrayList),
                        // }
                    }
*/
                }catch(error){
                    console.log(error)
                    return {
                        statusCode: 400,
                        headers: {
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Headers': '*',
                        },
                        body: JSON.stringify(error),
                    }
                }
            } else {
                // orderBy = "ORDER BY Reservation.updatedAt DESC, Customer.updatedAt DESC";
                orderBy = "ORDER BY Customer.updatedAt DESC";
            }

            console.log("💤💤💤💤💤💤 queryFrom ", queryFrom);
            console.log("💤💤💤💤💤💤 whereQuery ", whereQuery);
            console.log("💤💤💤💤💤💤 queryFrom2 ", queryFrom2);
            console.log("💤💤💤💤💤💤 whereQuery2 ", whereQuery2);
            console.log("💤💤💤💤💤💤 customFieldFrom ", customFieldFrom);

            queryFrom = queryFrom + " " + queryFrom2;
            whereQuery = whereQuery + " " + whereQuery2;

            let sql_count = `
SELECT COUNT(Customer.updatedAt) as total_rows 
FROM Customer AS Customer
            LEFT OUTER JOIN Reservation ON Customer.customerId = Reservation.customerId
            LEFT OUTER JOIN Event ON Customer.eventId = Event.eventId
            ${queryFrom}
            ${customFieldFrom}
            WHERE 1=1 ${(whereQuery)}`;

            console.log(sql_count);

            // Always get last. otherwise it will appear at the top
            let appendQuery = '';
            if (queryField) {
                appendQuery = ', Customer.customerId, Customer.token1, Customer.token2, Customer.token3, Reservation.reservationId, Reservation.reservationNo, Event.eventId, Event.eventMailFlag, Reservation.reservationStatus, Reservation.reservationEventCategoryId AS eventCategoryId';
            } else {
                appendQuery = 'Customer.customerId, Customer.token1, Customer.token2, Customer.token3, Reservation.reservationId, Reservation.reservationNo, Event.eventId, Event.eventMailFlag, Reservation.reservationStatus, Reservation.reservationEventCategoryId AS eventCategoryId';
            }
            let sql_data = `
            SELECT
            ${queryField}
            ${appendQuery}
            FROM Customer AS Customer
            LEFT OUTER JOIN Reservation ON Customer.customerId = Reservation.customerId
            LEFT OUTER JOIN Event ON Customer.eventId = Event.eventId
            ${queryFrom}
            ${customFieldFrom}
            WHERE 1=1 ${(whereQuery)}
            ${orderBy}
            LIMIT ?, ?`;

            console.log('sql_final query',sql_data);    
            // console.log("fieldQueryListData", fieldQueryListData);
            try {
                // リストデータが含まれていた場合の処理のため、全てのデータをレコードに移し替える。リストデータがあったらマッチ処理をする
                var [query_result1, query_fields1] = await mysql_con.query(sql_count, parameter);
                console.log('countQUeryResult',query_result1[0]);
                parameter.push(Number(pagesVisited));
                parameter.push(Number(itemsPerPage));
                var [query_result2, query_fields2] = await mysql_con.query(sql_data, parameter);
                console.log('parameter',parameter); 
                console.log('resultsssssssssssss', query_result2);
                
                // let customFieldValue = `SELECT * FROM CustomerField where fieldId = ?`;

                // var [query_result2Data, query_fields2F] = await mysql_con.query(customFieldValue,[2332]);
                // console.log('query_result2Data',query_result2Data); 

                let record = [];
                let field = query_fields2
                // 行ごとにループ
                for (let i = 0; i < query_result2.length; i++) {
                    let row = query_result2[i];
                    // console.log('row>>>>>>>>>', row[0]);
                    let outRow = {};
                    // セルごとにループ
                    for (let j = 0; j < query_fields2.length; j++) {
                        // console.log('query_fields2query_fields2query_fields2',query_fields2[j]);
                        let cell = row[query_fields2[j].name];
// console.log('cell>>>>>>',cell);
                        let listCheckFlag = false;
                        if (fieldQueryListData2 !== undefined) {
                            // 行データのクエリーをループ
                            for (let k = 0; k < fieldQueryListData2.length; k++) {
                                // セルのフィールドコードとリストデータのフィールドコードが一致するか？
// console.log("fieldQueryListData[k].fieldStyle", fieldQueryListData[k].fieldStyle);
                                if (fieldQueryListData2[k].fieldStyle != null && query_fields2[j].name == fieldQueryListData2[k].fieldStyle.columnCode) {
                                    // マッチした場合配列とのチェックをする
// console.log("fieldQueryListData[k].fieldStyle name ===", fieldQueryListData[k].fieldStyle.columnCode);
                                    if(cell != null) {
                                        listCheckFlag = true;
                                        let matchData = [];
                                        for (let l = 0; l < cell.length; l++) {
                                            // console.log('celll>>>>>>>>>>>>>>>l', cell[l]);
                                            let cellObject = cell[l];
                                            let cellCode = '';
                                            if (cellObject.hasOwnProperty('id')) {
                                                cellCode = cell[l].id;
                                            } else { 
                                                cellCode = cell[l]
                                            }
                                            
                                            for (let m = 0; m < fieldQueryListData2[k].fieldStyle.lookup.length; m++) {
// console.log("cellCode", cellCode);
                                                if (cellCode == fieldQueryListData2[k].fieldStyle.lookup[m].fieldListCode) {
                                                    matchData.push(fieldQueryListData2[k].fieldStyle.lookup[m].inputBox2.value);
                                                    break;
                                                }
                                            }
                                        }
                                        outRow[query_fields2[j].name] = matchData.join(',');
                                        break;
                                    }
                                }
                            }
                        }
                        if (!listCheckFlag) {
                            outRow[query_fields2[j].name] = cell;
                        }
                    }
                    record.push(outRow);
                }
                console.log('record',record); 
                // 
                let response = {
                    count: query_result1[0]?.total_rows,
                    records: record,
                    page: pagesVisited,
                    limit: itemsPerPage,
                    templatefieldList:templatefieldList
                }
                console.log(response);
                return {
                    statusCode: 200,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': '*',
                    },
                    body: JSON.stringify(response),
                }
            } catch (error) {
                console.log(error)
                return {
                    statusCode: 400,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': '*',
                    },
                    body: JSON.stringify(error),
                }
            }
        }
        else {
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify({message: "invalid parameter"}),
            }
        }
    }
    else {
        console.log(" one data =");
        console.log(event.pathParameters.reservationId);
        let sql_data = `SELECT *
            FROM Reservation INNER JOIN Customer ON Reservation.customerId = Customer.customerId
            WHERE Reservation.reservationId = ?
            LIMIT 0, 1`
        try {
            var [query_result, query_fields] = await mysql_con.query(sql_data, [event.pathParameters.reservationId]);
            if (query_result.length === 0) {
                return {
                    statusCode: 200,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': '*',
                    },
                    body: JSON.stringify({message: "no data"}),
                }
            }
            // 
            let response = {
                records: query_result[0]
            }
            // console.log(res1.records[0].count);
            // console.log(response);
            return {
                statusCode: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(response),
            }
        } catch (error) {
           console.log(error)
           return {
               statusCode: 400,
               headers: {
                   'Access-Control-Allow-Origin': '*',
                   'Access-Control-Allow-Headers': '*',
               },
               body: JSON.stringify(error),
           }
        }
    }
 }