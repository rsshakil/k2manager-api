var deps = 0;
var from = ""
var where = ""
var fieldCode = [];
var fieldData = [];
var numOfField = 1;
// フィルターデータをSQLクエリに転用する
const fieldColumnMapper = require('./mapperObject');

exports.getWhereFromFilter = async (mysql_con, filter) => {
	console.log("filter", filter);
	from = ""
	where = "";
	try {
		if (filter) {
			fieldCode = makeFieldList(filter);
			let fieldSql = `SELECT * FROM Field WHERE fieldCode IN (?) ORDER BY FIELD(fieldCode, ?)`
			var [query_result, query_fields] = await mysql_con.query(fieldSql, [fieldCode, fieldCode]);
			fieldData = query_result;
		}
		deps = 0;
		checkFilterCirculator(filter);
		return [from, "AND (" + where + ")"];
	} catch (error) {
		console.log(error);
		return "";
	}

	/*
		let where = "";
		let fieldCode = [];
		let fieldOperation = [];
		let fieldValue = [];
		try {
			// create a date in YYYY-MM-DD HH:Mi format
			if (filterData) {
	// console.log(" filterData", filterData);
				// 条件の分解
				for (let i = 0; i < filterData.length; i++) {
					let row = filterData[i]
					if (Array.isArray(row) && row.length != 1) {
	// console.log(" row", row);
						fieldCode.push(row[0]);
						fieldOperation.push(row[1]);
						fieldValue.push((row[2])? row[2]:"");
					}
				}
	// console.log(" fieldCode", fieldCode);
				// SQLの作成
				let fieldSql = `SELECT * FROM Field WHERE fieldCode IN (?) ORDER BY FIELD(fieldCode, ?)`
				var [query_result, query_fields] = await mysql_con.query(fieldSql, [fieldCode, fieldCode]);
	// console.log("query_result", query_result);
				for (let i = 0; i < query_result.length; i++) {
					let row = query_result[i];
					if (row.fieldColumnName) {
						let query = row.fieldColumnName;
						where += ` AND ${getSql(fieldOperation[i], row.fieldColumnName, fieldValue[i])}`
					}
				}
			}
	// console.log("WHERE", where);
			return where;
		} catch (error) {
			console.log(error);
			return where;
		}
	*/
}

function makeFieldList(filter) {
	for (let i = 0; i < filter.length; i++) {
		// let row = filterData[i]
		if (filter.length == 3 && (filter[1] != "and" && filter[1] != "or")) {
			if (filter[0].includes(".")) {
				filter[0] = filter[0].slice((filter[0].lastIndexOf(".")) + 1, filter[0].length)
			}

			fieldCode.push(filter[0]);

			if (["same", "notsame", "samedate", "notsamedate"].includes(filter[1])) {
				if (filter[2].includes(".")) {
					filter[2] = filter[2].slice((filter[2].lastIndexOf(".")) + 1, filter[2].length)
				}
				fieldCode.push(filter[2]);
			}
		}
		else {
			let row = filter[i];
			if (!Array.isArray(row)) {
				++deps;
			}
			else if (row[1] != "and" && row[1] != "or") {
				// console.log("fieldCode pish --- 2 ", row[0]);
				fieldCode.push(row[0]);

				if (["same", "notsame", "samedate", "notsamedate"].includes(row[1])) {
					if (row[2].includes(".")) {
						row[2] = row[2].slice((row[2].lastIndexOf(".")) + 1, row[2].length)
					}
					fieldCode.push(row[2]);
				}
			}
			else {
				// console.log("xxx -------- 3 start");
				// ++deps;
				fieldCode = makeFieldList(row);
				// console.log("xxx -------- 3 row", check);
				// latestCheck = check;
			}
		}
	}
	--deps;
	return fieldCode;
}

function checkFilterCirculator(filter) {
	for (let i = 0; i < filter.length; i++) {
		//For condition
		if (filter.length == 3 && (filter[1] != "and" && filter[1] != "or")) {
			where += conditionMatch(filter)
			// console.log("where add  1 ----- ", where);
			// console.log("deps ----- 1 ----- ", deps);
			break;
		}
		else {
			let row = filter[i];
			// AND ORだった場合
			if (!Array.isArray(row)) {
				// console.log("row  ----- 2 ----- ", row);
				// ++deps;
				if (row == "and") {
					where += " and "
				}
				else {
					where += " or "
				}
				// console.log("where add  2 ----- ", where);
				// console.log("deps ----- 2 ----- ", deps);
			}
			// 条件の場合 (For condition)
			else if (row[1] != "and" && row[1] != "or") {
				// console.log("row  ----- 3 ----- ", row);
				where += conditionMatch(row);
				// console.log("where add  3 ----- ", where);
				// console.log("deps ----- 3 ----- ", deps);
			}
			// 子供条件だった場合
			else {
				where = where + "(";
				// console.log("xxx -------- 3 start");
				++deps;
				// console.log("row  ----- 4 ----- ", row);
				// where += checkFilterCirculator(row);
				checkFilterCirculator(row);
				// console.log("where add  4 ----- ", where);
				// console.log("deps ----- 4 ----- ", deps);
				where = where + ")";
			}
		}
	}
	--deps;
	return where;
}

function conditionMatch(conditionArray = []) {
	let where2;
	// const key = conditionArray[0];
	const operation = conditionArray[1];
	let value = conditionArray[2];
	const key = fieldData.find(x => x.fieldCode == conditionArray[0]);

	console.log('my check ->>>>> key', key)

	const generateSqlPortionForCustomField = (key) => {
		// customerViewTemplateFrom += ` LEFT OUTER JOIN CustomerField AS f${numOfField} ON Customer.customerId = f${numOfField}.customerId AND f${numOfField}.fieldId = ${row.fieldId} `; 
		from += ` LEFT OUTER JOIN CustomerField AS ff${numOfField} ON Customer.customerId = ff${numOfField}.customerId AND ff${numOfField}.fieldId = ${key.fieldId} `
		// console.log("from2 = ", from);

		let fName = '';
		switch (key.fieldType) {
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
		return fName;
	}


	let orgFieldColumnName = '';
	// カスタムフィールドの検索
	if (!key.fieldColumnName && key.projectId != 0) {
		const fName = generateSqlPortionForCustomField(key);
		orgFieldColumnName = `ff${numOfField}.${fName}`;
		numOfField++;

	}
	// 特殊フィールドの検索
	else {
		orgFieldColumnName = key.fieldColumnName;
	}

	if (["same", "notsame", "samedate", "notsamedate"].includes(operation)) {
		const key = fieldData.find(x => x.fieldCode == conditionArray[2]);
		// カスタムフィールドの検索
		if (!key.fieldColumnName && key.projectId != 0) {
			const fName = generateSqlPortionForCustomField(key);
			value = `ff${numOfField}.${fName}`;
			numOfField++;
		}
		// 特殊フィールドの検索
		else {
			value = key.fieldColumnName;
		}
	}

	where2 = getSql(operation, orgFieldColumnName, value, key.fieldType);

	// console.log("row.fieldCode", value);
	// console.log("row.fieldCode", value[0].fieldColumnName);
	// const where2 = getSql(operation, key, value[0].fieldColumnName)
	/*
	// console.log("regex =====================", key);
	// console.log("regex =====================", body[key].fieldType);
	// console.log("regex =====================", body[key].fieldValue);
		const [filterValue, fieldValue] = dataMold(body[key].fieldType, value, body[key].fieldValue);
	console.log("regex =====================", filterValue);
	console.log("regex =====================", fieldValue);
	
		// console.log("xxx -------- 2 start");
		const check = match(filterValue, fieldValue, operation, body);
		console.log("regex ===================== ----------check", check)
	*/
	return where2;
}


function getSql(operation, columnName, fieldValue, fieldType = 0) {
	console.log("operation === ", operation);
	console.log("columnName === ", columnName);
	console.log("fieldValue === ", fieldValue);

	let query = "";
	switch (operation) {
		case "=":
			// ---- is empty
			if (fieldValue === null) {
				if (fieldValue === null || fieldValue === undefined || fieldValue.length === 0) {
					query = `(${columnName} = "" OR ${columnName} IS NULL)`; break;
				}

				// // list type
				// if (fieldValue && Array.isArray(fieldValue)) {
				// 	query = `${columnName} = ""`; break;
				// }
				// else {
				// 	if (fieldValue === null || fieldValue === undefined || fieldValue.length === 0) {
				// 		query = `${columnName} = ""`; break;
				// 	}
				// }
			}
			// boolean type
			else if (typeof fieldValue === 'boolean') {
				// boolean === boolean
				if (typeof fieldValue === 'boolean') {
					if (fieldValue !== undefined) {
						if (fieldValue) {
							query = `${columnName} = 1`; break;
						}
						else {
							query = `${columnName} = 0`; break;
						}
					}
				}
			}
			else if (fieldValue !== undefined) {
				query = `${columnName} = '${fieldValue}'`; break;
			}
			break;
		case "<>":
			// ---- is empty
			if (fieldValue === null) {
				// list type
				if (fieldValue && Array.isArray(fieldValue)) {
					query = `${columnName} != ""`; break;
				}
				else {
					if (fieldValue === null || fieldValue === undefined || fieldValue.length === 0) {
						query = `${columnName} != ""`; break;
					}
				}
			}
			// boolean type
			else if (typeof fieldValue === 'boolean') {
				// boolean === boolean
				if (typeof fieldValue === 'boolean') {
					if (fieldValue !== undefined) {
						if (fieldValue) {
							query = `${columnName} != 1`; break;
						}
						else {
							query = `${columnName} != 0`; break;
						}
					}
				}
			}
			else if (fieldValue !== undefined) {
				// query = `${columnName} != '${fieldValue}'`;break;
				query = `(${columnName} != '${fieldValue}' OR ${columnName} IS NULL)`; break;
			}
			break;
		case "<":
			query = `${columnName} < ${fieldValue}`; break;
		case ">":
			query = `${columnName} > ${fieldValue}`; break;
		case "<=":
			query = `${columnName} <= ${fieldValue}`; break;
		case ">=":
			query = `${columnName} >= ${fieldValue}`; break;
		case "contains":
			query = `INSTR(${columnName}, '${fieldValue}') > 0`; break;
		case "notcontains":
			//query = `INSTR(${columnName}, '${fieldValue}') = 0`;break;
			query = `(INSTR(${columnName}, '${fieldValue}') = 0 OR ${columnName} IS NULL)`; break;
		case "startswith":
			query = `${columnName} LIKE '${fieldValue}%'`; break;
		case "endswith":
			query = `${columnName} LIKE '%${fieldValue}'`; break;
		case "between":
			console.log("fieldType", fieldType);
			if (fieldType == 5) {
				let flg1 = toString.call(fieldValue[0]).slice(8, -1);
				let flg2 = toString.call(fieldValue[1]).slice(8, -1);
				let date1 = 0;
				let date2 = 0;
				if (flg1 == 'String') {
					date1 = Math.floor((new Date(fieldValue[0])).getTime() / 1000);
				}
				if (flg2 == 'String') {
					date2 = Math.floor((new Date(fieldValue[1])).getTime() / 1000);
				}
				query = `${columnName} BETWEEN ${date1} AND ${date2}`;
				console.log("query", query);
				break;
			}
			else {
				query = `${columnName} BETWEEN ${fieldValue[0]} AND ${fieldValue[1]}`;
				console.log("query", query);
				break;
			}
		case "minlength":
			// query = `LENGTH(${columnName}) >= ${fieldValue}`; break;       //The LENGTH function counts bytes
			query = `CHAR_LENGTH(${columnName}) >= ${fieldValue}`; break;     //The CHAR_LENGTH function counts characters
		case "maxlength":
			// query = `LENGTH(${columnName}) <= ${fieldValue}`; break;      //The LENGTH function counts bytes
			query = `CHAR_LENGTH(${columnName}) <= ${fieldValue}`; break;    //The CHAR_LENGTH function counts characters
		case "same":
			// query = `${columnName} = ${fieldValue}`; break;
			const modifiedFieldValueSame = fieldColumnMapper[fieldValue] ? fieldColumnMapper[fieldValue] : fieldValue;
			query = `BINARY COALESCE(${columnName}, '') = BINARY COALESCE(${modifiedFieldValueSame}, '')`; break;   // To campare the two column in case sensitive need to use BINARY & COALESCE is using to take NULL and empty are same before compairing
		case "notsame":
			// query = `${columnName} != ${fieldValue}`; break;
			const modifiedFieldValueNotSame = fieldColumnMapper[fieldValue] ? fieldColumnMapper[fieldValue] : fieldValue;
			query = `BINARY COALESCE(${columnName}, '') <> BINARY COALESCE(${modifiedFieldValueNotSame}, '')`; break;
		case "regex":
			switch (fieldValue) {
				// 半角数字のみ
				case "1":
					query = `(${columnName} regexp '^[0-9]*$' OR ${columnName} IS NULL )`; break;
				// 半角英語のみ
				case "2":
					query = `(${columnName} regexp '^[a-zA-Z]*$' OR ${columnName} IS NULL )`; break;
				// 半角英数字のみ
				case "3":
					query = `(${columnName} regexp '^[0-9a-zA-Z]*$' OR ${columnName} IS NULL )`; break;
				// 半角英数字と記号のみ
				case "4":
					// query = `${columnName} regexp '^[a-zA-Z0-9!-/:-@¥[-\`{-~]*$'`; break;   
					query = `(${columnName} regexp '^[a-zA-\`0-9!-/:-@¥{-~]*$' OR ${columnName} IS NULL )`; break;         //* means match 0 or more
				// 半角カタカナのみ
				case "5":
					query = `(${columnName} regexp '^[ｧ-ﾝﾞﾟ\-]*$' OR ${columnName} IS NULL )`; break;
				// 半角文字列
				case "6":
					// query = `${columnName} regexp '^[ｧ-ﾝﾞﾟa-zA-Z0-9!-/:-@¥[-\`{-~]*$'`; break; 
					query = `(${columnName} regexp '^[ｧ-ﾝﾞﾟa-zA-\`0-9!-/:-@¥{-~]*$' OR ${columnName} IS NULL )`; break;        //* means match 0 or more
				// 全角カタカナのみ
				case "7":
					query = `(${columnName} regexp '^[ァ-ンヴー]*$' OR ${columnName} IS NULL )`; break;
				// 全角文字列
				case "8":
					//query = `${columnName} regexp '^[^\x20-\x7e]*$'`; break;
					// query = `${columnName} regexp '^[\uFF01-\uFF5E\u3040-\u309F\u30A0-\u30FF\u31F0-\u31FF\u4E00-\u9FFF\u3000-\u303F]+$'`; break; //from chatGPT
					query = `(${columnName} regexp '^[^ -~｡-ﾟ]*$' OR ${columnName} IS NULL )`; break;
				// 電話番号
				case "9":
					// query = `${columnName} regexp '^0[-\d]{9,12}$'`; break;
					query = `(${columnName} regexp '^0[0-9]{1,4}-[0-9]{2,5}-[0-9]{2,5}$' OR ${columnName} IS NULL OR ${columnName} ='')`; break;
				// 郵便番号
				case "10":
					// query = `${columnName} regexp '^\d{3}-?\d{4}$'`; break;
					query = `(${columnName} regexp '^[0-9]{3}-[0-9]{4}$' OR ${columnName} IS NULL OR ${columnName} ='')`; break;
				// メールアドレス
				case "11":
					// query = `${columnName} regexp '^[A-Za-z0-9]{1}[A-Za-z0-9_.-]*@{1}[A-Za-z0-9_.-]+.[A-Za-z0-9]+$'`; break;
					query = `(${columnName} regexp '^[A-Za-z0-9]{1}[A-Za-z0-9_.-]*@{1}[A-Za-z0-9_.-]+.[A-Za-z0-9]+$' OR ${columnName} IS NULL OR ${columnName} ='')`; break;
			}
			break;
		case "isblank":
			query = `(${columnName} IS NULL OR ${columnName} = "")`; break;
		case "isnotblank":
			query = `(${columnName} IS NOT NULL OR ${columnName} != "")`; break;
		case "listinclude":
			// query = `${columnName} LIKE '%${fieldValue}%'`; break;
			if (isNaN(fieldValue) && fieldValue.length == 8 && /^[0-9a-f]{8}$/i.test(fieldValue)) {
				query = `JSON_CONTAINS(${columnName}, '"${fieldValue}"') OR JSON_CONTAINS(${columnName}, '{"id": "${fieldValue}"}')`; break;
			}
			else {
				query = `(JSON_CONTAINS(${columnName}, '{"id": ${fieldValue}}') OR JSON_CONTAINS(${columnName}, '{"id": "${fieldValue}"}')) `; break;
			}
		case "listnotinclude":
			// query = `(${columnName} NOT LIKE '%${fieldValue}%' OR ${columnName} IS NULL OR ${columnName} = "")`; break;
			if (isNaN(fieldValue) && fieldValue.length == 8 && /^[0-9a-f]{8}$/i.test(fieldValue)) {
				query = `(!(JSON_CONTAINS(${columnName}, '"${fieldValue}"') OR JSON_CONTAINS(${columnName}, '{"id": "${fieldValue}"}')) OR ${columnName} IS NULL OR ${columnName} = "")`; break;
			}
			else {
				query = `(!(JSON_CONTAINS(${columnName}, '{"id": ${fieldValue}}') OR JSON_CONTAINS(${columnName}, '{"id": "${fieldValue}"}')) OR ${columnName} IS NULL OR ${columnName} = "")`; break;
			}
		case "rangefrom":
			var date = new Date();
			var a = date.getTime();
			var now = Math.floor(a / 1000);
			var todaydata = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
			var today = Math.floor(todaydata / 1000);
			var head = fieldValue.substr(0, 1);
			var value = fieldValue.slice(1);
			if (head == "a") {
				if (value == "0") {
					query = `${columnName} >= ${now}`; break;
				}
				else {
					let dayUtime = Number(value) * 86400
					query = `${columnName} >= (${now} - ${dayUtime})`; break;
				}
			}
			else if (head == "b") {
				if (value == "0") {
					query = `${columnName} >= ${today}`; break;
				}
				else {
					let dayUtime = Number(value) * 86400
					query = `${columnName} >= (${today} - ${dayUtime})`; break;
				}
			}
			else if (head == "c") {
				let dayUtime = Number(value) * 86400
				query = `${columnName} >= (${now} + ${dayUtime})`; break;
			}
			else if (head == "d") {
				let dayUtime = Number(value) * 86400
				query = `${columnName} >= (${today} + ${dayUtime})`; break;
			}
			query = `${columnName} `; break;
		case "rangeto":
			var date = new Date();
			var a = date.getTime();
			var now = Math.floor(a / 1000);
			var todaydata = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
			var today = Math.floor(todaydata / 1000);
			var head = fieldValue.substr(0, 1);
			var value = fieldValue.slice(1);
			if (head == "a") {
				if (value == "0") {
					query = `${columnName} <= ${now}`; break;
				}
				else {
					let dayUtime = Number(value) * 86400
					query = `${columnName} <= (${now} - ${dayUtime})`; break;
				}
			}
			else if (head == "b") {
				if (value == "0") {
					query = `${columnName} <= ${today}`; break;
				}
				else {
					let dayUtime = Number(value) * 86400
					query = `${columnName} <= (${today} - ${dayUtime})`; break;
				}
			}
			else if (head == "c") {
				let dayUtime = Number(value) * 86400
				query = `${columnName} <= (${now} + ${dayUtime})`; break;
			}
			else if (head == "d") {
				let dayUtime = Number(value) * 86400
				query = `${columnName} <= (${today} + ${dayUtime})`; break;
			}
			query = `${columnName} `; break;
		case "nowgreaterthan":
			var now = Math.floor(new Date().getTime() / 1000);
			query = `${columnName} >= ${now}`; break;
		case "nowlessthan":
			var now = Math.floor(new Date().getTime() / 1000);
			query = `${columnName} <= ${now}`; break;
		case "=date":
			// 日付計算
			if (fieldValue !== undefined) {
				let fieldDateValue = formatDate(new Date(fieldValue), 'yyyyMMdd');
				query = `DATE_FORMAT(DATE_ADD(FROM_UNIXTIME(0), INTERVAL ${columnName} SECOND), '%Y%m%d') = '${fieldDateValue}'`; break;
			}
			break;
		case "<>date":
			// 日付計算
			if (fieldValue !== undefined) {
				let fieldDateValue = formatDate(new Date(fieldValue), 'yyyyMMdd');
				query = `DATE_FORMAT(DATE_ADD(FROM_UNIXTIME(0), INTERVAL ${columnName} SECOND), '%Y%m%d') != '${fieldDateValue}'`; break;
			}
			break;
		case "<date":
			// 日付計算
			if (fieldValue !== undefined) {
				let fieldDateValue = formatDate(new Date(fieldValue), 'yyyyMMdd');
				query = `DATE_FORMAT(DATE_ADD(FROM_UNIXTIME(0), INTERVAL ${columnName} SECOND), '%Y%m%d') < '${fieldDateValue}'`; break;
			}
			break;
		case ">date":
			// 日付計算
			if (fieldValue !== undefined) {
				let fieldDateValue = formatDate(new Date(fieldValue), 'yyyyMMdd');
				query = `DATE_FORMAT(DATE_ADD(FROM_UNIXTIME(0), INTERVAL ${columnName} SECOND), '%Y%m%d') > '${fieldDateValue}'`; break;
			}
			break;
		case "<=date":
			// 日付計算
			if (fieldValue !== undefined) {
				let fieldDateValue = formatDate(new Date(fieldValue), 'yyyyMMdd');
				query = `DATE_FORMAT(DATE_ADD(FROM_UNIXTIME(0), INTERVAL ${columnName} SECOND), '%Y%m%d') <= '${fieldDateValue}'`; break;
			}
			break;
		case ">=date":
			// 日付計算
			if (fieldValue !== undefined) {
				let fieldDateValue = formatDate(new Date(fieldValue), 'yyyyMMdd');
				query = `DATE_FORMAT(DATE_ADD(FROM_UNIXTIME(0), INTERVAL ${columnName} SECOND), '%Y%m%d') >= '${fieldDateValue}'`; break;
			}
			break;
		case "samedate":
			if (fieldValue !== undefined) {
				const modifiedFieldValueSame = fieldColumnMapper[fieldValue] ? fieldColumnMapper[fieldValue] : fieldValue;
				query = `DATE_FORMAT(DATE_ADD(FROM_UNIXTIME(0), INTERVAL COALESCE(${columnName}, '') SECOND), '%Y%m%d') = DATE_FORMAT(DATE_ADD(FROM_UNIXTIME(0), INTERVAL COALESCE(${modifiedFieldValueSame}, '') SECOND), '%Y%m%d')`; break; // COALESCE is using to take NULL and empty as same before compairing
			}
			break;
		case "notsamedate":
			if (fieldValue !== undefined) {
				const modifiedFieldValueNotSame = fieldColumnMapper[fieldValue] ? fieldColumnMapper[fieldValue] : fieldValue;
				query = `DATE_FORMAT(DATE_ADD(FROM_UNIXTIME(0), INTERVAL COALESCE(${columnName}, '') SECOND), '%Y%m%d') != DATE_FORMAT(DATE_ADD(FROM_UNIXTIME(0), INTERVAL COALESCE(${modifiedFieldValueNotSame}, '') SECOND), '%Y%m%d')`; break;  // COALESCE is using to take NULL and empty as same before compairing
			}
			break;
	}
	// console.log("getSql result ===", query);
	return query;
}

function formatDate(date, format) {
	format = format.replace(/yyyy/g, date.getFullYear());
	format = format.replace(/MM/g, ('0' + (date.getMonth() + 1)).slice(-2));
	format = format.replace(/dd/g, ('0' + date.getDate()).slice(-2));
	format = format.replace(/HH/g, ('0' + date.getHours()).slice(-2));
	format = format.replace(/mm/g, ('0' + date.getMinutes()).slice(-2));
	format = format.replace(/ss/g, ('0' + date.getSeconds()).slice(-2));
	format = format.replace(/SSS/g, ('00' + date.getMilliseconds()).slice(-3));
	return format;
};