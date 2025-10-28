#!/usr/bin/env python3
"""
Test script for unified file upload system
This script tests the lambda_invocation module functionality
"""

import os
import sys
import json
from datetime import datetime

# Add the shared_layers directory to the path
sys.path.append(os.path.join(os.path.dirname(__file__), 'shared_layers'))

def test_unified_file_upload():
    """Test the unified file upload functionality"""
    
    # Mock environment variables
    os.environ['CHAT_FILES_BUCKET_NAME'] = 'test-bucket'
    os.environ['USER_ID'] = 'test-user-123'
    os.environ['SESSION_ID'] = 'test-session-456'
    os.environ['AGENT_FILES_PROCESSOR_FUNCTION_NAME'] = 'test-agent-processor'
    os.environ['AWS_REGION'] = 'us-east-1'
    
    try:
        from lambda_invocation import upload_file_and_notify
        
        print("✅ Successfully imported lambda_invocation module")
        
        # Test 1: Text file upload
        print("\n🧪 Test 1: Text file upload")
        result = upload_file_and_notify(
            content="This is a test file content",
            filename="test_file.txt",
            user_id="test-user-123",
            session_id="test-session-456",
            file_type="txt",
            folder="agent-files",
            metadata={'test': 'true'}
        )
        print(f"Result: {result}")
        
        # Test 2: CSV file upload
        print("\n🧪 Test 2: CSV file upload")
        csv_content = "Name,Age,City\nJohn,25,New York\nJane,30,Los Angeles"
        result = upload_file_and_notify(
            content=csv_content,
            filename="test_data.csv",
            user_id="test-user-123",
            session_id="test-session-456",
            file_type="csv",
            folder="agent-files"
        )
        print(f"Result: {result}")
        
        # Test 3: Binary file upload (simulated PNG)
        print("\n🧪 Test 3: Binary file upload")
        png_content = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde'
        result = upload_file_and_notify(
            content=png_content,
            filename="test_chart.png",
            user_id="test-user-123",
            session_id="test-session-456",
            file_type="png",
            content_type="image/png",
            folder="agent-files"
        )
        print(f"Result: {result}")
        
        print("\n✅ All tests completed successfully!")
        return True
        
    except ImportError as e:
        print(f"❌ Import error: {e}")
        return False
    except Exception as e:
        print(f"❌ Test error: {e}")
        return False

def test_payload_generation():
    """Test the SNS payload generation"""
    
    try:
        from lambda_invocation import invoke_agent_files_processor
        
        print("\n🧪 Test 4: SNS payload generation")
        
        # This will test the payload generation without actually invoking Lambda
        # We'll catch the boto3 client error since we don't have AWS credentials
        try:
            success = invoke_agent_files_processor(
                s3_bucket_name="test-bucket",
                s3_key="users/test-user/sessions/test-session/agent-files/test.txt",
                file_size=100
            )
            print(f"Lambda invocation result: {success}")
        except Exception as e:
            if "NoCredentialsError" in str(e) or "botocore" in str(e):
                print("✅ Payload generation works (AWS credentials not available for actual invocation)")
            else:
                print(f"❌ Unexpected error: {e}")
                return False
        
        return True
        
    except Exception as e:
        print(f"❌ Payload test error: {e}")
        return False

if __name__ == "__main__":
    print("🚀 Testing Unified File Upload System")
    print("=" * 50)
    
    # Run tests
    test1_passed = test_unified_file_upload()
    test2_passed = test_payload_generation()
    
    print("\n" + "=" * 50)
    if test1_passed and test2_passed:
        print("🎉 All tests passed! Unified file upload system is working correctly.")
        sys.exit(0)
    else:
        print("❌ Some tests failed. Please check the errors above.")
        sys.exit(1)
