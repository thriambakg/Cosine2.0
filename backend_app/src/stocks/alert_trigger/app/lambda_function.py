import boto3
import yfinance as yf
from botocore.exceptions import ClientError
from decimal import Decimal
import time

dynamodb = boto3.resource("dynamodb")
ses = boto3.client("ses")
table_name = "StockAlertsTable"  # Replace with your table name
table = dynamodb.Table(table_name)

def fetch_price(stock_symbol):
    """
    Fetch the current stock price using yfinance.
    """
    try:
        stock = yf.Ticker(stock_symbol)
        stock_info = stock.history(period="1d", interval="1m")
        current_price = stock_info["Close"].iloc[-1]
        return current_price
    except Exception as e:
        print(f"Error fetching price for {stock_symbol}: {e}")
        return None

def send_email_alert(alert, current_price):
    """
    Sends an email alert via Amazon SES.
    """
    subject = f"Stock Alert Triggered: {alert['stock_symbol']}"
    body = (
        f"Hello,\n\n"
        f"The stock {alert['stock_symbol']} has reached your threshold.\n"
        f"Current Price: ${current_price:.2f}\n"
        f"Threshold: ${alert['price_point']:.2f}\n\n"
        f"Regards,\nYour Stock Alert App"
    )

    try:
        ses.send_email(
            Source="noreply@yourdomain.com",  # Replace with a verified SES email
            Destination={"ToAddresses": [alert["user_email"]]},
            Message={
                "Subject": {"Data": subject},
                "Body": {"Text": {"Data": body}},
            },
        )
        print(f"Email sent to {alert['user_email']} for {alert['stock_symbol']}.")
    except ClientError as e:
        print(f"Error sending email: {e}")

def process_alerts():
    """
    Processes active alerts in the table and sends notifications if criteria are met.
    """
    try:
        response = table.scan(
            FilterExpression="status = :active",
            ExpressionAttributeValues={":active": "active"}
        )
        alerts = response.get("Items", [])

        for alert in alerts:
            stock_symbol = alert["stock_symbol"]
            price_point = Decimal(alert["price_point"])
            comparison_mode = alert["comparison_mode"]

            current_price = fetch_price(stock_symbol)
            if current_price is None:
                continue

            # Check if alert criteria are met
            if (comparison_mode == ">" and current_price >= price_point) or \
               (comparison_mode == "<" and current_price <= price_point):
                send_email_alert(alert, current_price)
                # Update alert status to 'triggered'
                table.update_item(
                    Key={"alert_id": alert["alert_id"]},
                    UpdateExpression="SET #status = :triggered",
                    ExpressionAttributeNames={"#status": "status"},
                    ExpressionAttributeValues={":triggered": "triggered"}
                )
    except Exception as e:
        print(f"Error processing alerts: {e}")

def lambda_handler(event, context):
    """
    Entry point for the Lambda function.
    """
    process_alerts()
    return {"statusCode": 200, "body": "Alerts processed successfully."}
