import json
import boto3
import os
from uuid import uuid4
from datetime import datetime
from decimal import Decimal
from botocore.exceptions import ClientError
from typing import Dict, Any
import logging

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize DynamoDB client
dynamodb = boto3.resource('dynamodb')
alerts_table_name = os.environ.get('ALERTS_TABLE_NAME', 'cosine-alerts-production')
user_profiles_table_name = os.environ.get('USER_PROFILES_TABLE_NAME', 'cosine-user-profiles-production')

alerts_table = dynamodb.Table(alerts_table_name)
user_profiles_table = dynamodb.Table(user_profiles_table_name)

def lambda_handler(event, context):
    """
    Handle stock alert operations (GET, POST, DELETE) using the new alerts table
    """
    try:
        logger.info("=== LAMBDA HANDLER STARTED ===")
        logger.info(f"Event: {json.dumps(event, default=str)}")
        logger.info(f"Context: {json.dumps({'function_name': context.function_name, 'function_version': context.function_version, 'invoked_function_arn': context.invoked_function_arn}, default=str)}")
        
        http_method = event.get('httpMethod', 'POST')
        logger.info(f"HTTP Method: {http_method}")
        
        if http_method == 'GET':
            logger.info("=== HANDLING GET REQUEST ===")
            return handle_get_alerts(event)
        elif http_method == 'POST':
            logger.info("=== HANDLING POST REQUEST ===")
            return handle_create_alert(event)
        elif http_method == 'DELETE':
            logger.info("=== HANDLING DELETE REQUEST ===")
            return handle_delete_alert(event)
        else:
            logger.error(f"=== UNSUPPORTED HTTP METHOD ===")
            logger.error(f"Method '{http_method}' not allowed")
            return {
                "statusCode": 405,
                "headers": {"Access-Control-Allow-Origin": "*"},
                "body": json.dumps({"message": "Method not allowed"})
            }
    except Exception as e:
        logger.error(f"=== LAMBDA HANDLER FAILED ===")
        logger.error(f"Exception: {str(e)}")
        logger.error(f"Exception type: {type(e).__name__}")
        import traceback
        logger.error(f"Full traceback: {traceback.format_exc()}")
        return {
            "statusCode": 500,
            "headers": {"Access-Control-Allow-Origin": "*"},
            "body": json.dumps({"message": "Internal server error"})
        }

def handle_get_alerts(event):
    """
    Get all alerts for a user from the alerts table
    """
    try:
        query_params = event.get('queryStringParameters') or {}
        user_id = query_params.get('userId')
        
        if not user_id:
            return {
                "statusCode": 400,
                "headers": {"Access-Control-Allow-Origin": "*"},
                "body": json.dumps({"message": "Missing userId parameter"})
            }
        
        # Get user profile to get email
        user_response = user_profiles_table.get_item(Key={'user_id': user_id})
        if 'Item' not in user_response:
            return {
                "statusCode": 404,
                "headers": {"Access-Control-Allow-Origin": "*"},
                "body": json.dumps({"message": "User not found"})
            }
        
        user_email = user_response['Item'].get('email', '')
        if not user_email:
            return {
                "statusCode": 400,
                "headers": {"Access-Control-Allow-Origin": "*"},
                "body": json.dumps({"message": "User email not found"})
            }
        
        # Query all active alerts and filter by user email
        response = alerts_table.query(
            KeyConditionExpression='alert_status = :status',
            ExpressionAttributeValues={
                ':status': 'active'
            }
        )
        
        # Filter alerts that contain this user's email
        alerts = []
        for alert in response.get('Items', []):
            notification_emails = alert.get('notification_emails', [])
            if user_email in notification_emails:
                alerts.append(alert)
        
        # Convert to frontend format
        formatted_alerts = []
        for alert in alerts:
            formatted_alerts.append({
                "alertId": alert.get('alert_id'),
                "status": alert.get('alert_status'),
                "createdAt": alert.get('created_at'),
                "triggerConditions": {
                    "ticker": alert.get('ticker'),
                    "alertType": alert.get('alert_type'),
                    "threshold": alert.get('threshold')
                }
            })
        
        return {
            "statusCode": 200,
            "headers": {"Access-Control-Allow-Origin": "*"},
            "body": json.dumps({"alerts": formatted_alerts})
        }
        
    except Exception as e:
        logger.error(f"Error getting alerts: {str(e)}")
        return {
            "statusCode": 500,
            "headers": {"Access-Control-Allow-Origin": "*"},
            "body": json.dumps({"message": "Internal server error"})
        }

def handle_delete_alert(event):
    """
    Delete a specific alert from the alerts table
    """
    try:
        query_params = event.get('queryStringParameters') or {}
        user_id = query_params.get('userId')
        alert_id = query_params.get('alertId')
        
        if not user_id or not alert_id:
            return {
                "statusCode": 400,
                "headers": {"Access-Control-Allow-Origin": "*"},
                "body": json.dumps({"message": "Missing userId or alertId parameter"})
            }
        
        # First, get the alert to find its status and created_at
        response = alerts_table.query(
            IndexName='AlertIdIndex',
            KeyConditionExpression='alert_id = :alert_id',
            ExpressionAttributeValues={
                ':alert_id': alert_id
            }
        )
        
        if not response.get('Items'):
            return {
                "statusCode": 404,
                "headers": {"Access-Control-Allow-Origin": "*"},
                "body": json.dumps({"message": "Alert not found"})
            }
        
        alert = response['Items'][0]
        
        # Get user profile to get email for verification
        user_response = user_profiles_table.get_item(Key={'user_id': user_id})
        if 'Item' not in user_response:
            return {
                "statusCode": 404,
                "headers": {"Access-Control-Allow-Origin": "*"},
                "body": json.dumps({"message": "User not found"})
            }
        
        user_email = user_response['Item'].get('email', '')
        
        # Verify the alert belongs to the user
        notification_emails = alert.get('notification_emails', [])
        if user_email not in notification_emails:
            return {
                "statusCode": 403,
                "headers": {"Access-Control-Allow-Origin": "*"},
                "body": json.dumps({"message": "Access denied"})
            }
        
        # Remove user's email from notification list
        notification_emails.remove(user_email)
        
        if len(notification_emails) == 0:
            # If no emails left, delete the entire alert
            alerts_table.delete_item(
                Key={
                    'alert_status': alert.get('alert_status'),
                    'created_at': alert.get('created_at')
                }
            )
            logger.info(f"Deleted alert {alert_id} as no emails remain")
        else:
            # Update the alert with remaining emails
            alerts_table.update_item(
                Key={
                    'alert_status': alert.get('alert_status'),
                    'created_at': alert.get('created_at')
                },
                UpdateExpression='SET notification_emails = :emails',
                ExpressionAttributeValues={
                    ':emails': notification_emails
                }
            )
            logger.info(f"Removed email {user_email} from alert {alert_id}, {len(notification_emails)} emails remain")
        
        return {
            "statusCode": 200,
            "headers": {"Access-Control-Allow-Origin": "*"},
            "body": json.dumps({"message": "Alert deleted successfully"})
        }
        
    except Exception as e:
        logger.error(f"Error deleting alert: {str(e)}")
        return {
            "statusCode": 500,
            "headers": {"Access-Control-Allow-Origin": "*"},
            "body": json.dumps({"message": "Internal server error"})
        }

def handle_create_alert(event):
    """
    Create a stock alert and store it in the alerts table
    """
    try:
        logger.info("=== ALERT CREATION STARTED ===")
        logger.info(f"Raw event received: {json.dumps(event, default=str)}")
        
        # Handle both direct body and API Gateway format
        if isinstance(event.get('body'), str):
            body = json.loads(event["body"])
            logger.info("Parsed body from string format")
        else:
            body = event.get('body', event)
            logger.info("Using body directly from event")
            
        logger.info(f"Processed request body: {json.dumps(body, default=str)}")
            
        # Extract parameters
        user_id = body.get("userId")
        ticker = body.get("ticker") 
        alert_type = body.get("alertType")  # 'price_above' or 'price_below'
        threshold = body.get("threshold")
        
        logger.info(f"=== EXTRACTED PARAMETERS ===")
        logger.info(f"user_id: {user_id}")
        logger.info(f"ticker: {ticker}")
        logger.info(f"alert_type: {alert_type}")
        logger.info(f"threshold: {threshold} (type: {type(threshold)})")
        
        # Validate input
        if not user_id or not ticker or not alert_type or threshold is None:
            logger.error("=== VALIDATION FAILED ===")
            logger.error(f"Missing required fields - user_id: {bool(user_id)}, ticker: {bool(ticker)}, alert_type: {bool(alert_type)}, threshold: {threshold is not None}")
            return {
                "statusCode": 400,
                "headers": {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "Content-Type",
                    "Access-Control-Allow-Methods": "POST"
                },
                "body": json.dumps({"message": "Missing required fields: userId, ticker, alertType, threshold"})
            }
        
        if alert_type not in ['price_above', 'price_below']:
            logger.error(f"=== INVALID ALERT TYPE ===")
            logger.error(f"alert_type '{alert_type}' not in allowed values: ['price_above', 'price_below']")
            return {
                "statusCode": 400,
                "headers": {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "Content-Type", 
                    "Access-Control-Allow-Methods": "POST"
                },
                "body": json.dumps({"message": "Invalid alertType. Must be 'price_above' or 'price_below'"})
            }
        
        logger.info("=== FETCHING USER PROFILE ===")
        logger.info(f"Querying user_profiles table for user_id: {user_id}")
        
        # Verify user exists and get user email
        user_response = user_profiles_table.get_item(Key={'user_id': user_id})
        logger.info(f"User profile query response: {json.dumps(user_response, default=str)}")
        
        if 'Item' not in user_response:
            logger.error(f"=== USER NOT FOUND ===")
            logger.error(f"User {user_id} not found in user_profiles table")
            return {
                "statusCode": 404,
                "headers": {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "Content-Type",
                    "Access-Control-Allow-Methods": "POST"
                },
                "body": json.dumps({"message": "User profile not found. Please ensure you are logged in and try again."})
            }
        
        user_profile = user_response['Item']
        logger.info(f"=== USER PROFILE RETRIEVED ===")
        logger.info(f"User profile: {json.dumps(user_profile, default=str)}")
        
        # Get user email for notifications
        user_email = user_profile.get('email', '')
        logger.info(f"=== USER EMAIL EXTRACTION ===")
        logger.info(f"Extracted email: {user_email}")
        
        if not user_email:
            logger.error(f"=== EMAIL NOT FOUND ===")
            logger.error(f"User {user_id} has no email address in profile")
            return {
                "statusCode": 400,
                "headers": {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "Content-Type",
                    "Access-Control-Allow-Methods": "POST"
                },
                "body": json.dumps({"message": "User email not found. Please update your profile and try again."})
            }
        
        logger.info("=== CHECKING FOR EXISTING ALERT ===")
        logger.info(f"Searching for identical alert - ticker: {ticker.upper()}, alert_type: {alert_type}, threshold: {threshold}")
        
        # Check if an identical alert already exists
        existing_alert = find_identical_alert(ticker.upper(), alert_type, threshold)
        
        if existing_alert:
            logger.info(f"=== EXISTING ALERT FOUND ===")
            logger.info(f"Existing alert details: {json.dumps(existing_alert, default=str)}")
            
            # Add this user's email to the existing alert's notification list
            update_success = update_alert_with_new_email(existing_alert, user_email)
            if update_success:
                alert_id = existing_alert['alert_id']
                created_at = existing_alert['created_at']
                logger.info(f"=== SUCCESSFULLY ADDED TO EXISTING ALERT ===")
                logger.info(f"Added user {user_id} (email: {user_email}) to existing alert {alert_id}")
            else:
                logger.error("=== FAILED TO UPDATE EXISTING ALERT ===")
                return {
                    "statusCode": 500,
                    "headers": {
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Headers": "Content-Type",
                        "Access-Control-Allow-Methods": "POST"
                    },
                    "body": json.dumps({"message": "Failed to update existing alert"})
                }
        else:
            logger.info("=== NO EXISTING ALERT FOUND - CREATING NEW ALERT ===")
            
            # Create new alert
            alert_id = str(uuid4())
            created_at = datetime.utcnow().isoformat()
            
            new_alert = {
                'alert_status': 'active',
                'created_at': created_at,
                'alert_id': alert_id,
                'ticker': ticker.upper(),
                'alert_type': alert_type,
                'threshold': Decimal(str(threshold)), # Convert float to Decimal for DynamoDB
                'notification_emails': [user_email]  # List of emails to notify
            }
            
            logger.info(f"=== NEW ALERT PAYLOAD ===")
            logger.info(f"Alert to be created: {json.dumps(new_alert, default=str)}")
            
            # Store alert in the alerts table
            logger.info(f"Storing alert in DynamoDB table: {alerts_table_name}")
            alerts_table.put_item(Item=new_alert)
            logger.info(f"=== NEW ALERT CREATED SUCCESSFULLY ===")
            logger.info(f"Created new alert {alert_id} for user {user_id} (email: {user_email})")
        
        logger.info(f"=== ALERT CREATION COMPLETED ===")
        logger.info(f"Final alert_id: {alert_id}")
        logger.info(f"Final created_at: {created_at}")
        
        response_payload = {
            "alertId": alert_id,
            "status": "active", 
            "message": "Alert created successfully",
            "createdAt": created_at,
            "triggerConditions": {
                "ticker": ticker.upper(),
                "alertType": alert_type,
                "threshold": float(threshold)  # Convert back to float for JSON response
            }
        }
        
        logger.info(f"=== RESPONSE PAYLOAD ===")
        logger.info(f"Returning response: {json.dumps(response_payload, default=str)}")
        
        return {
            "statusCode": 201,
            "headers": {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Content-Type",
                "Access-Control-Allow-Methods": "POST"
            },
            "body": json.dumps(response_payload)
        }
            
    except Exception as e:
        logger.error(f"=== ALERT CREATION FAILED ===")
        logger.error(f"Exception occurred: {str(e)}")
        logger.error(f"Exception type: {type(e).__name__}")
        import traceback
        logger.error(f"Full traceback: {traceback.format_exc()}")
        return {
            "statusCode": 500,
            "headers": {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Content-Type",
                "Access-Control-Allow-Methods": "POST"
            },
            "body": json.dumps({"message": "Internal server error"})
        }

def find_identical_alert(ticker: str, alert_type: str, threshold) -> Dict[str, Any]:
    """
    Find an existing alert with identical ticker, alert_type, and threshold
    """
    try:
        logger.info(f"=== SEARCHING FOR IDENTICAL ALERT ===")
        logger.info(f"Search criteria - ticker: {ticker}, alert_type: {alert_type}, threshold: {threshold}")
        
        # Query all active alerts for this ticker
        query_params = {
            'KeyConditionExpression': 'alert_status = :status',
            'FilterExpression': 'ticker = :ticker AND alert_type = :alert_type AND threshold = :threshold',
            'ExpressionAttributeValues': {
                ':status': 'active',
                ':ticker': ticker,
                ':alert_type': alert_type,
                ':threshold': Decimal(str(threshold)) # Convert float to Decimal for DynamoDB
            }
        }
        
        logger.info(f"Query parameters: {json.dumps(query_params, default=str)}")
        logger.info(f"Querying table: {alerts_table_name}")
        
        response = alerts_table.query(**query_params)
        
        logger.info(f"Query response: {json.dumps(response, default=str)}")
        
        items = response.get('Items', [])
        logger.info(f"Found {len(items)} matching alerts")
        
        if items:
            logger.info(f"Returning first matching alert: {json.dumps(items[0], default=str)}")
            return items[0]  # Return the first matching alert
        
        logger.info("No identical alert found")
        return None
        
    except Exception as e:
        logger.error(f"=== ERROR FINDING IDENTICAL ALERT ===")
        logger.error(f"Exception: {str(e)}")
        logger.error(f"Exception type: {type(e).__name__}")
        import traceback
        logger.error(f"Full traceback: {traceback.format_exc()}")
        return None

def update_alert_with_new_email(alert: Dict[str, Any], new_email: str) -> bool:
    """
    Add a new email to an existing alert's notification list
    """
    try:
        logger.info(f"=== UPDATING ALERT WITH NEW EMAIL ===")
        logger.info(f"Alert to update: {json.dumps(alert, default=str)}")
        logger.info(f"New email to add: {new_email}")
        
        notification_emails = alert.get('notification_emails', [])
        logger.info(f"Current notification emails: {notification_emails}")
        
        # Don't add duplicate emails
        if new_email not in notification_emails:
            logger.info(f"Email {new_email} not in current list, adding...")
            notification_emails.append(new_email)
            logger.info(f"Updated notification emails list: {notification_emails}")
            
            # Update the alert in the table
            update_params = {
                'Key': {
                    'alert_status': alert['alert_status'],
                    'created_at': alert['created_at']
                },
                'UpdateExpression': 'SET notification_emails = :emails',
                'ExpressionAttributeValues': {
                    ':emails': notification_emails
                }
            }
            
            logger.info(f"Update parameters: {json.dumps(update_params, default=str)}")
            logger.info(f"Updating alert in table: {alerts_table_name}")
            
            alerts_table.update_item(**update_params)
            
            logger.info(f"=== SUCCESSFULLY UPDATED ALERT ===")
            logger.info(f"Added email {new_email} to alert {alert['alert_id']}")
            return True
        else:
            logger.info(f"=== EMAIL ALREADY EXISTS ===")
            logger.info(f"Email {new_email} already exists in alert {alert['alert_id']}")
            return True
            
    except Exception as e:
        logger.error(f"=== ERROR UPDATING ALERT WITH NEW EMAIL ===")
        logger.error(f"Exception: {str(e)}")
        logger.error(f"Exception type: {type(e).__name__}")
        import traceback
        logger.error(f"Full traceback: {traceback.format_exc()}")
        return False
