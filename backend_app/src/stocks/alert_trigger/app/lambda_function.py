import boto3
import urllib.request
import json
import os
from botocore.exceptions import ClientError
from decimal import Decimal
import logging
from typing import Dict, Any, List
from datetime import datetime

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
dynamodb = boto3.resource("dynamodb")
ses = boto3.client("ses")

# Table configuration
alerts_table_name = os.environ.get('ALERTS_TABLE_NAME', 'cosine-alerts-production')
alerts_table = dynamodb.Table(alerts_table_name)

def fetch_price(stock_symbol: str) -> float:
    """
    Fetch the current stock price using Yahoo Finance API directly
    """
    try:
        # Use Yahoo Finance quote API
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{stock_symbol}"
        
        with urllib.request.urlopen(url) as response:
            data = json.loads(response.read().decode())
            
        # Extract current price from response
        if 'chart' in data and 'result' in data['chart'] and data['chart']['result']:
            result = data['chart']['result'][0]
            if 'meta' in result and 'regularMarketPrice' in result['meta']:
                return float(result['meta']['regularMarketPrice'])
                
        logger.warning(f"Could not fetch price for {stock_symbol}")
        return None
        
    except Exception as e:
        logger.error(f"Error fetching price for {stock_symbol}: {str(e)}")
        return None

def send_email_alert(notification_emails: list, alert: Dict[str, Any], current_price: float) -> bool:
    """
    Sends email alerts to all emails in the notification list via Amazon SES.
    """
    try:
        ticker = alert['ticker']
        threshold = alert['threshold']
        alert_type = alert['alert_type']
        
        # Determine condition text
        condition = "above" if alert_type == "price_above" else "below"
        
        subject = f"🚨 Stock Alert Triggered: {ticker}"
        body = (
            f"Hello,\n\n"
            f"Your stock alert has been triggered!\n\n"
            f"Stock: {ticker}\n"
            f"Current Price: ${current_price:.2f}\n"
            f"Alert Threshold: ${threshold:.2f} ({condition})\n"
            f"Condition: Price went {condition} your threshold\n\n"
            f"This alert has been automatically disabled.\n\n"
            f"Best regards,\n"
            f"Cosine Stock Alert System"
        )

        # Send email to all notification emails
        ses.send_email(
            Source=os.environ.get('SES_FROM_EMAIL', 'noreply@cosine-ai.com'),
            Destination={"ToAddresses": notification_emails},
            Message={
                "Subject": {"Data": subject},
                "Body": {"Text": {"Data": body}},
            },
        )
        
        logger.info(f"Email sent to {len(notification_emails)} recipients for {ticker} alert")
        return True
        
    except ClientError as e:
        logger.error(f"Error sending email to {notification_emails}: {str(e)}")
        return False

def process_alerts() -> Dict[str, Any]:
    """
    Processes active alerts from the alerts table and sends notifications if criteria are met.
    """
    processed_count = 0
    triggered_count = 0
    error_count = 0
    
    try:
        # Query all active alerts
        response = alerts_table.query(
            KeyConditionExpression='alert_status = :status',
            ExpressionAttributeValues={
                ':status': 'active'
            }
        )
        
        active_alerts = response.get("Items", [])
        logger.info(f"Processing {len(active_alerts)} active alerts")

        for alert in active_alerts:
            processed_count += 1
            ticker = alert.get('ticker')
            threshold = float(alert.get('threshold', 0))
            alert_type = alert.get('alert_type')
            notification_emails = alert.get('notification_emails', [])
            alert_id = alert.get('alert_id')
            created_at = alert.get('created_at')
            
            if not notification_emails:
                logger.warning(f"Alert {alert_id} has no notification emails, skipping")
                error_count += 1
                continue
                
            # Fetch current price
            current_price = fetch_price(ticker)
            if current_price is None:
                error_count += 1
                continue

            # Check if alert criteria are met
            alert_triggered = False
            if alert_type == "price_above" and current_price >= threshold:
                alert_triggered = True
            elif alert_type == "price_below" and current_price <= threshold:
                alert_triggered = True
                
            if alert_triggered:
                # Send email notification to all emails in the list
                if send_email_alert(notification_emails, alert, current_price):
                    # Delete the alert (since triggered alerts should be removed immediately)
                    try:
                        alerts_table.delete_item(
                            Key={
                                'alert_status': 'active',
                                'created_at': created_at
                            }
                        )
                        triggered_count += 1
                        logger.info(f"Alert {alert_id} triggered and deleted for {ticker}, price ${current_price}, sent to {len(notification_emails)} recipients")
                    except Exception as e:
                        logger.error(f"Error deleting triggered alert {alert_id}: {str(e)}")
                        error_count += 1
                else:
                    error_count += 1
                    
    except Exception as e:
        logger.error(f"Error processing alerts: {str(e)}")
        error_count += 1
    
    return {
        "processed": processed_count,
        "triggered": triggered_count,
        "errors": error_count
    }

def lambda_handler(event, context):
    """
    Entry point for the Lambda function.
    Processes all active stock alerts and sends notifications.
    """
    try:
        logger.info("Starting alert processing")
        
        result = process_alerts()
        
        logger.info(f"Alert processing completed: {result}")
        
        return {
            "statusCode": 200,
            "body": json.dumps({
                "message": "Alert processing completed",
                "result": result
            })
        }
        
    except Exception as e:
        logger.error(f"Error in lambda_handler: {str(e)}")
        return {
            "statusCode": 500,
            "body": json.dumps({
                "message": "Internal server error",
                "error": str(e)
            })
        }
