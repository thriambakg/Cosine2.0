import { NextRequest, NextResponse } from 'next/server';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';

// Environment variables for DynamoDB
const REGION = process.env.AWS_REGION || 'us-east-1';
const USER_PROFILES_TABLE = process.env.USER_PROFILES_TABLE_NAME;

const dynamo = new DynamoDBClient({ region: REGION });

export async function POST(req: NextRequest) {
  try {
    const { user_id, email, firstName, lastName, phoneNumber } = await req.json();
    if (!user_id || !email) {
      return NextResponse.json({ error: 'Missing user_id or email' }, { status: 400 });
    }
    const now = new Date().toISOString();
    const params = {
      TableName: USER_PROFILES_TABLE,
      Item: {
        user_id: { S: user_id },
        email: { S: email },
        first_name: { S: firstName || '' },
        last_name: { S: lastName || '' },
        phone_number: { S: phoneNumber || '' },
        created_at: { S: now },
      },
      ConditionExpression: 'attribute_not_exists(user_id)'
    };
    await dynamo.send(new PutItemCommand(params));
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('DynamoDB error:', err);
    return NextResponse.json({ error: err.message || 'Failed to save user profile' }, { status: 500 });
  }
}
