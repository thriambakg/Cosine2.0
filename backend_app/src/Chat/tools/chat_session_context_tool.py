"""
Chat Session Context Tool

This tool allows the agent to process chat session context items that have been
added from the history sidebar. It can retrieve and analyze chat sessions
based on their metadata.
"""

import json
import logging
from typing import Dict, Any, List, Optional
from strands import tool

logger = logging.getLogger(__name__)

# Import agent_logger for WebSocket streaming
try:
    import sys
    import os
    sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
    from agent_logger import get_agent_logger
    agent_logger = get_agent_logger()
except:
    agent_logger = logger

@tool
def process_chat_session_context_tool(session_id: str, user_id: str, context_items: str) -> Dict[str, Any]:
    """
    Process chat session context items that have been added from the history sidebar.
    
    Args:
        session_id: Current session ID
        user_id: Current user ID
        context_items: JSON string containing context items with chat session data
        
    Returns:
        Dictionary containing processed chat session context information
    """
    try:
        agent_logger.info("Processing chat session context")
        # Parse context items
        context_data = json.loads(context_items)
        
        logger.info(f"🔍 DEBUG: Received context_items: {len(str(context_items))} characters")
        logger.info(f"🔍 DEBUG: Parsed context_data type: {type(context_data)}")
        logger.info(f"🔍 DEBUG: Context data length: {len(context_data) if isinstance(context_data, list) else 'not a list'}")
        
        if not isinstance(context_data, list):
            return {
                "success": False,
                "error": "Context items must be a list",
                "processed_sessions": []
            }
        
        processed_sessions = []
        
        for i, item in enumerate(context_data):
            logger.info(f"🔍 DEBUG: Processing context item {i}: type={item.get('type')}, keys={list(item.keys())}")
            
            if item.get('type') != 'chat':
                logger.info(f"🔍 DEBUG: Skipping non-chat item: {item.get('type')}")
                continue
                
            session_info = item.get('data', {})
            session_id_ref = session_info.get('session_id')
            
            logger.info(f"🔍 DEBUG: Session info keys: {list(session_info.keys())}")
            logger.info(f"🔍 DEBUG: Session ID: {session_id_ref}")
            
            if not session_id_ref:
                logger.warning(f"⚠️ No session_id found in context item {i}")
                continue
                
            # Since we only store metadata in context, we need to fetch the actual session data
            try:
                # Get the session data from the database using the session_id
                from tools.session_database_access import SessionDatabaseAccess
                db_access = SessionDatabaseAccess()
                session_data = db_access.get_session_context(session_id_ref, user_id)
                
                if not session_data.get('exists', False):
                    logger.warning(f"⚠️ Session {session_id_ref} not found in database")
                    continue
                    
                # Extract messages from the session data
                messages = session_data.get('session_metadata', {}).get('messages', [])
                
                # Convert messages to conversation format
                conversations = []
                for message in messages:
                    if message.get('sender') == 'user':
                        conversations.append({
                            'timestamp': message.get('timestamp', 0),
                            'user_message': message.get('text', ''),
                            'agent_response': ''
                        })
                    elif message.get('sender') == 'bot':
                        # Add to the last conversation entry or create new one
                        if conversations and conversations[-1]['agent_response'] == '':
                            conversations[-1]['agent_response'] = message.get('text', '')
                        else:
                            conversations.append({
                                'timestamp': message.get('timestamp', 0),
                                'user_message': '',
                                'agent_response': message.get('text', '')
                            })
                
                # Process the conversation data
                session_summary = {
                    "session_id": session_id_ref,
                    "title": item.get('title', f'Chat {session_id_ref[:8]}'),
                    "model": session_info.get('model', 'unknown'),
                    "message_count": session_info.get('message_count', 0),
                    "conversations": conversations,
                    "total_conversations": len(conversations),
                    "context_added_at": item.get('timestamp', 0),
                    "session_data": session_data  # Include full session data for reference
                }
                
                processed_sessions.append(session_summary)
                
                logger.info(f"✅ Processed chat session context: {session_id_ref} with {len(conversations)} conversations")
                    
            except Exception as e:
                logger.error(f"❌ Error processing session {session_id_ref}: {str(e)}")
                continue
        
        return {
            "success": True,
            "processed_sessions": processed_sessions,
            "total_sessions": len(processed_sessions),
            "message": f"Successfully processed {len(processed_sessions)} chat session(s) from context"
        }
        
    except json.JSONDecodeError as e:
        logger.error(f"❌ Invalid JSON in context items: {str(e)}")
        return {
            "success": False,
            "error": f"Invalid JSON format: {str(e)}",
            "processed_sessions": []
        }
    except Exception as e:
        logger.error(f"❌ Error processing chat session context: {str(e)}")
        return {
            "success": False,
            "error": f"Unexpected error: {str(e)}",
            "processed_sessions": []
        }

@tool
def analyze_chat_session_context_tool(session_id: str, user_id: str, context_items: str, analysis_type: str = "summary") -> Dict[str, Any]:
    """
    Analyze chat session context items to provide insights and summaries.
    
    Args:
        session_id: Current session ID
        user_id: Current user ID
        context_items: JSON string containing context items with chat session data
        analysis_type: Type of analysis to perform ("summary", "topics", "trends", "insights")
        
    Returns:
        Dictionary containing analysis results
    """
    try:
        # First process the context items
        process_result = process_chat_session_context_tool(session_id, user_id, context_items)
        
        if not process_result.get('success'):
            return process_result
            
        processed_sessions = process_result.get('processed_sessions', [])
        
        if not processed_sessions:
            return {
                "success": True,
                "analysis_type": analysis_type,
                "results": {},
                "message": "No chat sessions found in context to analyze"
            }
        
        # Perform analysis based on type
        if analysis_type == "summary":
            return _analyze_summary(processed_sessions)
        elif analysis_type == "topics":
            return _analyze_topics(processed_sessions)
        elif analysis_type == "trends":
            return _analyze_trends(processed_sessions)
        elif analysis_type == "insights":
            return _analyze_insights(processed_sessions)
        else:
            return {
                "success": False,
                "error": f"Unknown analysis type: {analysis_type}",
                "supported_types": ["summary", "topics", "trends", "insights"]
            }
            
    except Exception as e:
        logger.error(f"❌ Error analyzing chat session context: {str(e)}")
        return {
            "success": False,
            "error": f"Analysis error: {str(e)}",
            "results": {}
        }

def _analyze_summary(sessions: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Generate a summary of the chat sessions."""
    total_messages = sum(session.get('message_count', 0) for session in sessions)
    total_conversations = sum(session.get('total_conversations', 0) for session in sessions)
    
    # Get unique models used
    models = list(set(session.get('model', 'unknown') for session in sessions))
    
    # Get date range
    timestamps = []
    for session in sessions:
        for conv in session.get('conversations', []):
            if conv.get('timestamp'):
                timestamps.append(conv['timestamp'])
    
    date_range = {}
    if timestamps:
        date_range = {
            "earliest": min(timestamps),
            "latest": max(timestamps)
        }
    
    return {
        "success": True,
        "analysis_type": "summary",
        "results": {
            "total_sessions": len(sessions),
            "total_messages": total_messages,
            "total_conversations": total_conversations,
            "models_used": models,
            "date_range": date_range,
            "sessions": [
                {
                    "session_id": session.get('session_id'),
                    "title": session.get('title'),
                    "model": session.get('model'),
                    "message_count": session.get('message_count'),
                    "conversation_count": len(session.get('conversations', []))
                }
                for session in sessions
            ]
        },
        "message": f"Analyzed {len(sessions)} chat session(s) with {total_messages} total messages"
    }

def _analyze_topics(sessions: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Analyze topics discussed across chat sessions."""
    # Simple topic extraction based on common financial terms
    financial_keywords = [
        'stock', 'stocks', 'portfolio', 'investment', 'trading', 'market',
        'crypto', 'bitcoin', 'ethereum', 'analysis', 'chart', 'price',
        'earnings', 'dividend', 'volatility', 'risk', 'return', 'correlation'
    ]
    
    topic_counts = {}
    all_messages = []
    
    for session in sessions:
        for conv in session.get('conversations', []):
            user_msg = conv.get('user_message', '')
            agent_msg = conv.get('agent_response', '')
            all_messages.extend([user_msg, agent_msg])
    
    # Count keyword occurrences
    for message in all_messages:
        if not message:
            continue
        message_lower = message.lower()
        for keyword in financial_keywords:
            if keyword in message_lower:
                topic_counts[keyword] = topic_counts.get(keyword, 0) + 1
    
    # Sort by frequency
    sorted_topics = sorted(topic_counts.items(), key=lambda x: x[1], reverse=True)
    
    return {
        "success": True,
        "analysis_type": "topics",
        "results": {
            "topics": sorted_topics[:10],  # Top 10 topics
            "total_messages_analyzed": len(all_messages),
            "unique_topics": len(topic_counts)
        },
        "message": f"Analyzed topics across {len(sessions)} chat session(s)"
    }

def _analyze_trends(sessions: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Analyze trends across chat sessions."""
    # This is a simplified trend analysis
    # In a real implementation, you might want to use more sophisticated NLP
    
    trends = {
        "session_frequency": len(sessions),
        "models_used": list(set(session.get('model', 'unknown') for session in sessions)),
        "average_messages_per_session": sum(session.get('message_count', 0) for session in sessions) / len(sessions) if sessions else 0
    }
    
    return {
        "success": True,
        "analysis_type": "trends",
        "results": trends,
        "message": f"Analyzed trends across {len(sessions)} chat session(s)"
    }

def _analyze_insights(sessions: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Generate insights from chat sessions."""
    insights = []
    
    # Insight 1: Most active session
    if sessions:
        most_active = max(sessions, key=lambda s: s.get('message_count', 0))
        insights.append({
            "type": "most_active_session",
            "description": f"Most active session: {most_active.get('title')} with {most_active.get('message_count', 0)} messages"
        })
    
    # Insight 2: Model usage
    model_counts = {}
    for session in sessions:
        model = session.get('model', 'unknown')
        model_counts[model] = model_counts.get(model, 0) + 1
    
    if model_counts:
        most_used_model = max(model_counts.items(), key=lambda x: x[1])
        insights.append({
            "type": "model_usage",
            "description": f"Most used model: {most_used_model[0]} ({most_used_model[1]} sessions)"
        })
    
    # Insight 3: Total activity
    total_messages = sum(session.get('message_count', 0) for session in sessions)
    insights.append({
        "type": "total_activity",
        "description": f"Total messages across all sessions: {total_messages}"
    })
    
    return {
        "success": True,
        "analysis_type": "insights",
        "results": {
            "insights": insights,
            "total_sessions": len(sessions)
        },
        "message": f"Generated insights from {len(sessions)} chat session(s)"
    }
