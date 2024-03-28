
/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
 const AWS = require('aws-sdk')
 const mysql = require("mysql2/promise");
 const ssm = new AWS.SSM();
 let dbreadendpoint,dbwriteendpoint,dbuser,dbpassword,dbdatabase,dbport,dbcharset;
 
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
        let projectId = (jsonBody?.pid || jsonBody?.pid == 0) ? jsonBody?.pid : 0;
        if (projectId != 0) {
            let pagesVisited = (jsonBody?.pagesVisited || jsonBody?.pagesVisited == 0) ? jsonBody?.pagesVisited : 0;
            let itemsPerPage = (jsonBody?.itemsPerPage || jsonBody?.itemsPerPage == 0) ? jsonBody?.itemsPerPage : 500;
            // Other search query ( roleId , accountName)
            let parameter = [];
            let whereQuery = "";
            let orderBy = "";
            // console.log(jsonBody);
            whereQuery += ` AND Event.projectId = ?`;
            parameter.push(Number(projectId));
            // template 5 or 6
            if (jsonBody.customerId) {
                whereQuery += ` AND Customer.customerId = ?`;
                // parameter.push("%" + jsonBody.customerId + "%");//before it was like
                parameter.push(Number(jsonBody.customerId));
            }
           
            // template id
            var queryField = 'Customer.customerId,Customer.updatedAt,Reservation.reservationId';
            var queryFrom = '';
            var templatefieldList = [];
            var editTemplateFieldList = [];
            if (jsonBody.templateId) {
                //get templateInfo
                try {
                    if(jsonBody.customerId){
                        //this is for customerEdit view
                        const sql_edit_template_data = `SELECT customerEditTemplateColumn FROM CustomerEditTemplate WHERE CustomerEditTemplate.projectId = ? AND CustomerEditTemplate.customerEditTemplateId = ?`
                        var [query_result_customerEditTemplate, query_Templatefields] = await mysql_con.query(sql_edit_template_data, [projectId, jsonBody.templateId]);
                        let customerEditTemplateColumn = query_result_customerEditTemplate[0].customerEditTemplateColumn;
                        console.log("customerEditTemplateColumn", JSON.stringify(customerEditTemplateColumn));
                        if (customerEditTemplateColumn && customerEditTemplateColumn.length > 0) {
                            let fieldIdArrays = customerEditTemplateColumn.map(item => {
                                if (item.fTypeId > 0) {
                                    return {
                                        position: item.currentPos,
                                        fieldId: item.fTypeId,
                                        requiredStatus:item?.checkbox1?.checked
                                    }
                                }
                            })
                            fieldIdArrays.sort((a, b) => (a.position > b.position ? 1 : -1));
                            let fieldIdArray = fieldIdArrays.map(item => {
                                if (item.fieldId > 0) {
                                    return item.fieldId
                                }
                            })
                            console.log("fieldIdArrays", JSON.stringify(fieldIdArrays));
                            let fieldQueryParam = [];
                            //get field list
                            const sql_data_fields = `SELECT * FROM Field WHERE 1=1 AND fieldId IN (?) AND (projectId = 0 OR projectId = ?) ORDER BY Field.fieldId ASC`;
                            fieldQueryParam.push(fieldIdArray);
                            fieldQueryParam.push(Number(projectId));
                            let [query_result_field_name] = await mysql_con.query(sql_data_fields, fieldQueryParam);
                            console.log("fieldIdArrays", JSON.stringify(fieldIdArrays));
                            let templatefieldList = query_result_field_name;
                            let numOfField = 1;

                            let fieldIdArrayList = fieldIdArrays.map(item => {
                                let row = templatefieldList.find(fieldRow => fieldRow.fieldId == item.fieldId);
                                row.requiredStatus = item?.requiredStatus;
                                // YesNo型の場合SQLを変更する
                                if (row.projectId != 0) {
                                    let fName = '';
                                    switch (row.fieldType) {
                                        case 0:
                                        case 1:
                                        case 2:
                                            //text
                                            fName = 'customerFieldText';
                                            row.fieldColumnName = `f${numOfField}.${fName} as '${row.fieldCode}'`;
                                            break;
                                        case 3:
                                            //list
                                            fName = 'customerFieldList';
                                            row.fieldColumnName = `f${numOfField}.${fName} as '${row.fieldCode}'`;
                                            break;
                                        case 4:
                                            //bool
                                            fName = 'customerFieldBoolean';
                                            // row.fieldColumnName = `CASE WHEN f${numOfField}.${fName} = 1 THEN '${row.fieldStyle.trueText}' ELSE '${row.fieldStyle.falseText}' END`;
                                            row.fieldColumnName = `f${numOfField}.${fName} as '${row.fieldCode}'`;
                                            break;
                                        case 5:
                                        case 6:
                                        case 7:
                                            //int
                                            fName = 'customerFieldInt';
                                            row.fieldColumnName = `f${numOfField}.${fName} as '${row.fieldCode}'`;
                                            break;
                                    }
                                    queryFrom += ` LEFT OUTER JOIN CustomerField AS f${numOfField} ON Customer.customerId = f${numOfField}.customerId AND f${numOfField}.fieldId = ${row.fieldId} AND (CASE WHEN Reservation.reservationNo IS NULL THEN '' ELSE Reservation.reservationNo END) = f${numOfField}.reservationNo`;
                                    numOfField++;
                                } else {
                                    //activity for project id is 0
                                    switch (row.fieldType) {
                                        case 0:
                                        case 1:
                                        case 2:
                                            break;
                                        case 3:
                                            // let allCondition = '';
                                            // row?.fieldStyle?.lookup?.map(item => {
                                            //     allCondition += `WHEN ${row.fieldColumnName} = ${item.fieldListCode} THEN '${item.inputBox2.value}' `;
                                            // });
                                            // console.log("getFieldType3SearchColumns", allCondition);
                                            // if (allCondition != '') {
                                            //     row.fieldColumnName = `CASE ${allCondition} ELSE '' END AS ${row.fieldColumnName.split('.')[1]}`;
                                            // }
                                            break;
                                        case 4:
                                            // row.fieldColumnName = `CASE WHEN ${row.fieldColumnName} = 1 THEN '${row.fieldStyle.trueText}' ELSE '${row.fieldStyle.falseText}' END AS ${row.fieldColumnName.split('.')[1]}`;
                                            row.fieldColumnName = `${row.fieldColumnName} AS '${row.fieldCode}'`;
                                            break;
                                        case 5:
                                            // row.fieldColumnName = `DATE_FORMAT(from_unixtime(${row.fieldColumnName}), '%Y/%m/%d') AS ${row.fieldColumnName.split('.')[1]}`;
                                            // row.fieldColumnName = `${row.fieldColumnName} AS ${row.fieldColumnName.split('.')[1]}`;
                                            row.fieldColumnName = `${row.fieldColumnName} AS ${row.fieldCode}`;
                                            break;
                                        case 6:
                                            row.fieldColumnName = `CASE WHEN ${row.fieldColumnName} = 0 THEN '' ELSE CONCAT(SUBSTRING(LPAD(${row.fieldColumnName}, 4, '0'), 1, 2), ':', SUBSTRING(LPAD(${row.fieldColumnName}, 4, '0'), 3, 2)) END AS ${row.fieldColumnName.split('.')[1]}`;
                                            break;
                                        case 7:
                                            row.fieldColumnName = `${row.fieldColumnName} AS ${row.fieldColumnName.split('.')[1]}`;
                                            break;
                                    }
                                }
                                return row;
                            });
                            editTemplateFieldList = [...fieldIdArrayList];
                            console.log("fieldIdArrayList", fieldIdArrayList);
                            console.log("editTemplateFieldList", editTemplateFieldList);
                            let fieldNameArray = fieldIdArrayList.map(item => {
                                if (item.fieldColumnName) {
                                    return item.fieldColumnName;
                                }
                            }).filter(e => typeof e !== 'undefined');
                            queryField  = fieldNameArray.join(', ');
                    
                        }

                    }else{
                        //this is for customer list view
                        const sql_dataTemplate = `SELECT customerViewTemplateQuery,customerViewTemplateFrom FROM CustomerViewTemplate WHERE CustomerViewTemplate.customerViewTemplateId = ?`
                        var [query_result_template] = await mysql_con.query(sql_dataTemplate, [jsonBody.templateId]);
                        let customerViewTemplateQuery = query_result_template[0].customerViewTemplateQuery;
                        queryField = customerViewTemplateQuery;
                        console.log('customerViewTemplateFrom',query_result_template[0].customerViewTemplateFrom);
                        queryFrom = query_result_template[0].customerViewTemplateFrom??'';
                    }
                    

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
                orderBy = "ORDER BY Customer.updatedAt DESC";
            }

            console.log(whereQuery);
            // total count sql
            let sql_count = `
                SELECT COUNT(Customer.updatedAt) FROM Customer AS Customer
                LEFT OUTER JOIN (SELECT *, MAX(reservationNo) AS lastReservationNo FROM Reservation GROUP BY customerId) AS Reservation
                ON Customer.customerId = Reservation.customerId
                LEFT OUTER JOIN Event ON Customer.eventId = Event.eventId
                WHERE 1=1 ${(whereQuery)}`;


            let appendQuery = '';
            if (queryField) {
                appendQuery = 'Customer.customerId, Event.eventId,Event.eventName,Reservation.reservationStatus, ';
            } else {
                appendQuery = 'Customer.customerId, Event.eventId,Event.eventName,Reservation.reservationStatus, ';
            }
            let sql_data = `
                SELECT 
                ${appendQuery}
                ${queryField}
                FROM Customer AS Customer
                LEFT OUTER JOIN Reservation ON Customer.customerId = Reservation.customerId
                LEFT OUTER JOIN Event ON Customer.eventId = Event.eventId
                ${queryFrom}
                WHERE 1=1 ${(whereQuery)}
                ${orderBy}
                LIMIT ?, ?`;

            console.log('sql_data',sql_data);    
            console.log('sql_count',sql_count);    
            try {
                // var [query_result1, query_fields1] = await mysql_con.query(sql_count, parameter);
                parameter.push(Number(pagesVisited));
                parameter.push(Number(itemsPerPage));
                var [query_result2, query_fields2] = await mysql_con.query(sql_data, parameter);
                
                let response = {
                    // count: query_result1[0].count,
                    records: query_result2,
                    // page: pagesVisited,
                    // limit: itemsPerPage,
                    templatefieldList:templatefieldList,
                    customerEditTemplateFieldList:editTemplateFieldList,
                }
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
    } else {
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