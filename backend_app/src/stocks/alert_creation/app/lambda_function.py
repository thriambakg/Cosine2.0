import json
import boto3
from uuid import uuid4
from datetime import datetime

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table("StockAlerts")

def lambda_handler(event, context):
    body = json.loads(event["body"])
    email = body["email"]
    stock_symbol = body["stock_symbol"]
    price_point = body["price_point"]
    comparison_mode = body["comparison_mode"]  # 1 for "greater than", 0 for "less than"
    
    # Validate input
    if not email or not stock_symbol or price_point is None or comparison_mode not in [0, 1]:
        return {
            "statusCode": 400,
            "body": json.dumps({"message": "Invalid input data."})
        }
    
    alert_id = str(uuid4())
    created_at = datetime.utcnow().isoformat()

    # Store alert in DynamoDB
    table.put_item(
        Item={
            "alert_id": alert_id,
            "email": email,
            "stock_symbol": stock_symbol.upper(),
            "price_point": price_point,
            "comparison_mode": comparison_mode,
            "alert_status": "active",
            "created_at": created_at,
        }
    )

    return {
        "statusCode": 201,
        "body": json.dumps({"message": "Alert created successfully.", "alert_id": alert_id})
    }
