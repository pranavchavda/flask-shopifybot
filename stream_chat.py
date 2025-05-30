import os
import asyncio
import json
import uuid
import datetime
import base64
import requests
from flask import current_app, request, Response, stream_with_context, jsonify, Blueprint
from flask_login import current_user, login_required

# Import db from extensions module
from extensions import db

# Import models from the new models.py file
from models import Conversation, Message, User

# Global flag to track active interruptions by user+conversation
interruption_flags = {}

def create_stream_blueprint(app, openai_client):
    stream_bp = Blueprint('stream_chat', __name__)

    # Global flag to signal interruption to all components
    _interrupt_flags = {}
    
    @stream_bp.route('/api/interrupt', methods=['POST'])
    @login_required
    def interrupt():
        """Interrupt the current chat processing"""
        global interruption_flags
        data = request.json
        conv_id = data.get('conv_id')
        
        if not conv_id:
            return jsonify({"error": "No conversation ID provided"}), 400
        
        # Set global interruption flag for this conversation
        flag_key = f"{current_user.id}:{conv_id}"
        interruption_flags[flag_key] = True
        print(f"Setting interruption flag for {flag_key}")
        
        # Add a system message to indicate interruption
        try:
            system_msg = Message(conv_id=conv_id, role='system', content='[User interrupted the conversation]')
            db.session.add(system_msg)
            db.session.commit()
        except Exception as e:
            print(f"Error recording interruption message: {e}")
        
        return jsonify({"success": True, "message": "Interruption requested"})

    @stream_bp.route('/stream_chat', methods=['POST'])
    @login_required
    def stream_chat():
        data = request.json
        conv_id = data.get('conv_id')
        message_text = data.get('message', '')
        image_data = data.get('image')
        is_interruption = data.get('is_interruption', False)

        conversation = None
        if conv_id:
            conversation = db.session.get(Conversation, conv_id)
            if not conversation or conversation.user_id != current_user.id:
                conv_id = None
                conversation = None

        if not conv_id:
            title_to_set = f"Chat from {datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M')}"
            try:
                print(f"DEBUG: Generating title with model: {os.environ.get('DEFAULT_MODEL', 'gpt-4.1-nano')}")
                title_resp = openai_client.chat.completions.create(
                    model=os.environ.get('DEFAULT_MODEL', 'gpt-4.1-nano'),
                    messages=[
                        {'role': 'system', 'content': 'You are an assistant that generates concise conversation titles.'},
                        {'role': 'user', 'content': f"Generate a short title (max 5 words) for a conversation starting with: {message_text}"}
                    ],
                    max_tokens=20
                )
                generated_title = title_resp.choices[0].message.content.strip()
                print(f"DEBUG: Generated title: '{generated_title}'")
                if generated_title:
                    title_to_set = generated_title
                    print(f"DEBUG: Title set to: '{title_to_set}'")
            except Exception as e:
                import traceback
                print(f"Error generating title: {e}")
                print(f"Title generation traceback: {traceback.format_exc()}")
                current_app.logger.error(f"Title generation failed: {e}")

            unique_filename = f"{uuid.uuid4()}.json"

            conversation = Conversation(
                user_id=current_user.id,
                title=title_to_set,
                filename=unique_filename
            )
            db.session.add(conversation)
            db.session.commit()
            conv_id = conversation.id

        user_message = Message(conv_id=conv_id, role='user', content=message_text)
        
        # Store image data reference in the message metadata if present
        if image_data:
            # We'll store a reference to indicate there was an image attachment
            # The actual image content is too large to efficiently store in the database
            user_message.metadata = json.dumps({
                'has_image': True,
                'image_type': image_data.get('type')
            })
        
        db.session.add(user_message)
        db.session.commit()

        messages_from_db = Message.query.filter_by(conv_id=conv_id).order_by(Message.created_at).all()
        history = [{'role': msg.role, 'content': msg.content} for msg in messages_from_db]

        def generate():
            yield f"data: {{\n"
            yield f"data: \"conv_id\": {conv_id},\n"
            yield f"data: \"streaming\": true,\n"
            yield f"data: \"content\": \"\",\n"
            yield f"data: \"suggestions\": [],\n"
            yield f"data: \"tool_calls\": []\n"
            yield f"data: }}\n\n"

            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

            full_response = ""
            final_assistant_message_content = None
            try:
                async def process_agent():
                    global interruption_flags
                    # Import here to avoid circular imports
                    from simple_agent import run_simple_agent
                    
                    # Create a key for this conversation
                    flag_key = f"{current_user.id}:{conv_id}"
                    
                    # Get user details
                    user = db.session.get(User, current_user.id)
                    user_name = user.name if user and user.name else "User"
                    user_bio = user.bio if user and user.bio else ""
                    user_id = user.id if user else None
                    
                    # Add a system message for interruptions
                    system_message = None
                    if is_interruption:
                        # Add a system message to inform the agent about the interruption
                        system_message = {
                            "role": "system",
                            "content": "The user has interrupted your current process with this message. "
                                       "Pause your current task, address their message, and then decide whether "
                                       "to continue your previous task or follow new instructions."
                        }
                    
                    # Prepare message content - could be text only or include an image
                    if image_data:
                        # Create a multimodal message with text and image
                        message_content = []
                        
                        # Add text part
                        message_content.append({
                            "type": "text", 
                            "text": message_text
                        })
                        
                        # Add image part
                        image_url = None
                        if image_data.get('type') == 'data_url':
                            # For data URLs, we already have the full data URL including the MIME type prefix
                            image_url = image_data.get('data')
                        elif image_data.get('type') == 'url':
                            # For external URLs, we use the URL directly
                            image_url = image_data.get('url')
                        
                        if image_url:
                            message_content.append({
                                "type": "image_url",
                                "image_url": {
                                    "url": image_url
                                }
                            })
                        
                        # Log that we're processing an image
                        current_app.logger.info(f"Processing multimodal content with image")
                    else:
                        # Text-only message - use the text directly as simple_agent can handle both string and list inputs
                        message_content = message_text
                    
                    async for chunk in run_simple_agent(
                        message_content, 
                        user_name, 
                        user_bio, 
                        history, 
                        streaming=True, 
                        user_id=user_id,
                        is_interruption=is_interruption,
                        system_message=system_message,
                        logger=current_app.logger):
                            
                        # Check if we've been interrupted
                        if flag_key in interruption_flags and interruption_flags[flag_key] and not is_interruption:
                            print(f"Detected interruption flag for {flag_key}, stopping processing")
                            # Return one last chunk indicating interruption
                            yield f"data: {{\n"
                            yield f"data: \"interrupted\": true,\n"
                            yield f"data: \"content\": \"Processing interrupted by user\"\n"
                            yield f"data: }}\n\n"
                            # Clear the flag since we've handled it
                            interruption_flags.pop(flag_key, None)
                            return
                            
                        if chunk.get('type') == 'content':
                            delta = chunk.get('delta', '')
                            full_response += delta
                            yield f"data: {{\n"
                            yield f"data: \"delta\": {json.dumps(delta)},\n"
                            yield f"data: \"content\": {json.dumps(full_response)}\n"
                            yield f"data: }}\n\n"
                        elif chunk.get('type') == 'tool_call':
                            yield f"data: {{\n"
                            yield f"data: \"tool_call\": {json.dumps(chunk)}\n"
                            yield f"data: }}\n\n"
                        elif chunk.get('type') == 'suggestions' and chunk.get('suggestions'):
                            yield f"data: {{\n"
                            yield f"data: \"suggestions\": {json.dumps(chunk.get('suggestions', []))}\n"
                            yield f"data: }}\n\n"
                        elif chunk.get('type') == 'task_update':
                            yield f"data: {{\n"
                            yield f"data: \"type\": \"task_update\",\n"
                            yield f"data: \"tasks\": {json.dumps(chunk.get('tasks', []))}\n"
                            yield f"data: }}\n\n"
                        elif chunk.get('type') == 'final':
                            final_assistant_message_content = chunk.get('content', '')

                async_gen = process_agent()
                while True:
                    try:
                        chunk = loop.run_until_complete(async_gen.__anext__())
                        yield chunk
                    except StopAsyncIteration:
                        break
                    except Exception as e_agen: # Catch exceptions from the async generator itself
                        print(f"Error during async_gen iteration: {e_agen}")
                        yield f"data: {{\"error\": {json.dumps(str(e_agen))}}}\n\n"
                        break # Stop streaming on error within the generator

                print(f"DEBUG stream_chat.py: final_assistant_message_content BEFORE save: '{final_assistant_message_content}'") # DEBUG
                if final_assistant_message_content:
                    assistant_message = Message(conv_id=conv_id, role='assistant', content=final_assistant_message_content)
                    db.session.add(assistant_message)
                    db.session.commit()

                yield f"data: {{\n"
                yield f"data: \"done\": true\n"
                yield f"data: }}\n\n"
            except Exception as e:
                import traceback
                error_traceback = traceback.format_exc()
                print(f"ERROR in /stream_chat route: {str(e)}")
                print(error_traceback)
                # Yield the full error and traceback to the client for debugging
                yield f"data: {{\n"
                yield f"data: \"error\": {json.dumps(str(e))},\n"
                yield f"data: \"traceback\": {json.dumps(error_traceback)}\n"
                yield f"data: }}\n\n"
            finally:
                loop.close()

        return Response(
            stream_with_context(generate()),
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'X-Accel-Buffering': 'no'
            }
        )

    return stream_bp