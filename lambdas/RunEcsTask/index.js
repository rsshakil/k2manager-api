const AWS = require("aws-sdk");

exports.handler = async (event) => {
    console.log("event: ", event);
    const command = event.command;
    console.log("command: ", command);
    var status;
    var message;

    const params = {
        "cluster": "k2app-x86",
        "count": 1,
        "enableECSManagedTags": true,
        "enableExecuteCommand": true,
        "launchType": "FARGATE",
        "networkConfiguration": {
            "awsvpcConfiguration": {
                "subnets": [
                    "subnet-0bbc611a4da79488d",
                    "subnet-0681427038500c119",
                    "subnet-07de2b352770d90ae"
                ],
                "securityGroups": [
                    "sg-092291d2733a1e699"
                ],
                "assignPublicIp": "ENABLED"
            }
        },
        "overrides": {
            "containerOverrides": [
                {
                    "name": "k2app-x86",
                    "command": command,
                    "memoryReservation": 4096
                }
            ],
            "cpu": "8192",
            "executionRoleArn": "arn:aws:iam::134712758746:role/ecsTaskExecutionRole",
            "memory": "16384",
            "taskRoleArn": "arn:aws:iam::134712758746:role/ecsTaskRole"
        },
        "platformVersion": "LATEST",
        "taskDefinition": "k2app-x86"
    };
    
    try {
        console.log("Going to call runTask");
        const ecs = new AWS.ECS();
        const res = await ecs.runTask(params).promise();
        console.log("runTask response: ", res);

        status = 200;
        message = "success";
    }
    catch (error) {
        console.log("error: ", error);
        status = 500;
        message = "error";
    }

    const response = {
        statusCode: status,
        body: JSON.stringify(message),
    };
    return response;
};
