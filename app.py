import os
import sys


# --- Ensure running inside venv ---
def _in_venv():
    return (hasattr(sys, 'real_prefix')
            or (hasattr(sys, 'base_prefix') and sys.base_prefix != sys.prefix))


def _find_venv_python():
    venv_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            'myenv')
    if os.name == 'nt':
        python_path = os.path.join(venv_dir, 'Scripts', 'python.exe')
    else:
        python_path = os.path.join(venv_dir, 'bin', 'python')
    return python_path if os.path.exists(python_path) else None


if not _in_venv():
    venv_python = _find_venv_python()
    if venv_python:
        print(f"[INFO] Relaunching in venv: {venv_python}")
        os.execv(venv_python, [venv_python] + sys.argv)
    else:
        print(
            "[WARNING] No venv found! Running with system Python. It is recommended to use a virtual environment in ./venv."
        )

from flask import Flask, request, jsonify, redirect, session, url_for
from uvicorn.middleware.wsgi import WSGIMiddleware
import uvicorn
import os
import json
import asyncio
from simple_agent import run_simple_agent
import openai
from responses_agent import run_responses_agent
from dotenv import load_dotenv
from flask_login import login_user, logout_user, current_user, login_required
from memory_service import memory_service
# UserMixin will be in models.py with the User model
import google_tasks


# Import Models
from models import User, Conversation, Message

# Import extensions
from extensions import db, migrate, login_manager, verify_db_connection

# Import blueprints - ensure stream_chat is imported before its blueprint is created/used
from stream_chat import create_stream_blueprint

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)
app.secret_key = os.environ.get('FLASK_SECRET_KEY',
                                'devsecret')  # Needed for session

# Database Configuration
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get(
    'DATABASE_URL',
    f"sqlite:///{os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shopify_agent.db')}"
)
print(f"DEBUG: Connecting to DB: {app.config['SQLALCHEMY_DATABASE_URI']}")
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Add SQLAlchemy connection pool settings for better resilience
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
    'pool_recycle': 300,  # Recycle connections after 5 minutes
    'pool_timeout': 20,  # Wait up to 20 seconds for a connection
    'pool_pre_ping': True,  # Enable connection health checks
    'connect_args': {
        'sslmode': 'require',  # Require SSL but don't verify
        'connect_timeout': 10,  # 10 second connection timeout
    }
}

# Initialize extensions with the app object
db.init_app(app)
migrate.init_app(app, db)  # Migrate needs db instance as well
login_manager.init_app(app)

# Verify database connection on startup
try:
    with app.app_context():
        success, message = verify_db_connection()
        if success:
            print("✅ Database connection verified successfully")
        else:
            print(f"⚠️ Warning: Database connection check failed: {message}")
except Exception as e:
    print(f"⚠️ Warning: Error checking database connection: {e}")

login_manager.login_view = None  # We are an API, frontend handles login prompts
login_manager.session_protection = "strong"


@app.route('/api/profile', methods=['GET'])
@login_required
def get_profile():
    return jsonify({
        "name": current_user.name,
        "email": current_user.
        email,  # Email is usually good to return, though not editable here
        "bio": current_user.bio
    }), 200


@app.route('/api/profile', methods=['PUT'])
@login_required
def update_profile():
    data = request.get_json()

    if 'name' in data:
        current_user.name = data['name']
    if 'bio' in data:
        current_user.bio = data['bio']

    db.session.commit()
    return jsonify({"message": "Profile updated successfully."}), 200


# User loader function uses the imported User model
@login_manager.user_loader
def load_user(user_id):
    return db.session.get(
        User, int(user_id))  # Use db.session.get for SQLAlchemy 2.0 style


@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()
    raw_email = data.get('email')
    password = data.get('password')
    name = data.get('name', None)

    if not raw_email or not password:
        return jsonify({"error": "Email and password are required"}), 400

    email = raw_email.lower()  # Convert to lowercase

    # Check if user already exists using the case-insensitive email
    if User.query.filter(db.func.lower(User.email) == email).first():
        return jsonify({"error": "Email address already registered"}), 400

    allowed_emails_str = os.environ.get('ALLOWED_EMAILS', '')
    # Convert allowed emails to lowercase for case-insensitive comparison
    allowed_emails = [
        e.strip().lower() for e in allowed_emails_str.split(',') if e.strip()
    ]
    is_whitelisted = email in allowed_emails

    new_user = User(email=email, name=name, is_whitelisted=is_whitelisted)
    new_user.set_password(password)

    db.session.add(new_user)
    db.session.commit()

    return jsonify({
        "message": "User registered successfully",
        "user_id": new_user.id,
        "email": new_user.email,
        "is_whitelisted": new_user.is_whitelisted
    }), 201


@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    raw_email = data.get('email')
    password = data.get('password')

    if not raw_email or not password:
        return jsonify({"error": "Email and password are required"}), 400

    email_to_check = raw_email.lower()  # Convert to lowercase for lookup

    # Case-insensitive email lookup
    user = User.query.filter(
        db.func.lower(User.email) == email_to_check).first()

    if user and user.check_password(password):
        if not user.is_whitelisted:
            return jsonify({"error":
                            "Access denied. User not whitelisted."}), 403

        login_user(user)
        return jsonify({
            "message": "Logged in successfully",
            "user": {
                "id": user.id,
                "email": user.email,
                "name": user.name,
                "is_whitelisted": user.is_whitelisted
            }
        }), 200

    return jsonify({"error": "Invalid email or password"}), 401


@app.route('/api/logout', methods=['POST'])
@login_required
def logout():
    logout_user()
    return jsonify({"message": "Logged out successfully"}), 200


@app.route('/api/check_auth', methods=['GET'])
def check_auth_status():
    if current_user.is_authenticated:
        return jsonify({
            "isAuthenticated": True,
            "user": {
                "id": current_user.id,
                "email": current_user.email,
                "name": current_user.name,
                "is_whitelisted": current_user.is_whitelisted
            }
        }), 200
    else:
        return jsonify({"isAuthenticated": False}), 401


@app.route('/api/check_db', methods=['GET'])
def check_db_connection():
    """Route to check database connection status"""
    success, error_message = verify_db_connection()
    return jsonify({
        "success":
        success,
        "message":
        "Database connection successful"
        if success else f"Database connection error: {error_message}"
    }), 200 if success else 500


# Initialize streaming endpoints
openai_client = openai.OpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""))
stream_bp = create_stream_blueprint(
    app, openai_client)  # Pass app and openai_client
app.register_blueprint(stream_bp)  # Register the blueprint

# The old PASSWORD var and 'from flask import session' might still be needed by other parts of the app.
# We will address removing them later if they become fully obsolete.


@app.route('/stream_chat', methods=['POST'])
@login_required
def stream_chat():
    """Stream chat messages using SSE"""
    data = request.json
    message = data.get('message', '')
    conv_id = data.get('conv_id')
    image = data.get('image')
    is_interruption = data.get('is_interruption', False)
    
    # Process image if present
    image_content = None
    if image:
        image_type = image.get('type')
        if image_type == 'data_url':
            # Handle data URL (base64)
            image_content = image.get('data')
        elif image_type == 'url':
            # Handle remote URL
            image_content = {'url': image.get('url')}

    def generate():
        from stream_chat import process_agent, SimpleStreamingResponse
        """Generator function for streaming responses"""
        
        if not message and not image_content:
            yield SimpleStreamingResponse(error="No message or image provided").to_sse()
            return
            
        # If this is an interruption message, add a system message to inform the agent
        interruption_context = None
        if is_interruption:
            interruption_context = "The user has interrupted your current process with this message. Pause your current task, address their message, and then decide whether to continue your previous task or follow new instructions."
        
        # Rest of the function remains the same
        # ...

@app.route('/chat', methods=['POST'])
@login_required
def chat():
    # Get the message and conversation history from the request
    data = request.json

    conv_id = data.get('conv_id')
    db = get_db()
    if not conv_id:
        cur = db.execute('INSERT INTO conversations DEFAULT VALUES')
        conv_id = cur.lastrowid
        db.commit()
        # Generate a title for the new conversation
        try:
            openai_client = openai.OpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""))
            title_resp = openai_client.chat.completions.create(
                model='gpt-4.1-nano',
                messages=[{
                    'role':
                    'system',
                    'content':
                    'You are an assistant that generates concise conversation titles.'
                }, {
                    'role':
                    'user',
                    'content':
                    f"Generate a short title (max 5 words) for a conversation starting with: {data.get('message','')}"
                }])
            title = title_resp.choices[0].message.content.strip()
        except Exception:
            title = f"Conversation {conv_id}"
        db.execute('UPDATE conversations SET title = ? WHERE id = ?',
                   (title, conv_id))
        db.commit()
    db.execute(
        'INSERT INTO messages (conv_id, role, content) VALUES (?, ?, ?)',
        (conv_id, 'user', data.get('message', '')))
    db.commit()
    rows = db.execute(
        'SELECT role, content FROM messages WHERE conv_id = ? ORDER BY id',
        (conv_id, )).fetchall()
    history = [{'role': r['role'], 'content': r['content']} for r in rows]

    # Run the agent in an async loop
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    # Create a task that can be cancelled
    task = None
    try:
        print(
            f"Processing chat request with message: {data.get('message','')[:50]}..."
        )
        # Run the agent and collect results (since it's an async generator)
        result = {'steps': []}
        try:

            async def collect_results():
                nonlocal result
                final_output = ""
                steps = []
                user_id = str(current_user.id) # Ensure user_id is a string
                user_message_original = data.get('message', '')

                proactively_retrieved_memory_context = ""
                try:
                    app.logger.info(f"[CHAT_MEMORY_PROACTIVE] Attempting to retrieve memories for user {user_id} for message: '{user_message_original[:50]}...'" )
                    # Ensure user_id is string for memory_service
                    retrieved_memory_contents = await memory_service.proactively_retrieve_memories(
                        user_id, 
                        user_message_original,
                        top_n=3 
                    )
                    if retrieved_memory_contents:
                        formatted_memories = "\n".join([f"- {mem}" for mem in retrieved_memory_contents])
                        proactively_retrieved_memory_context = (
                            "To help you respond, here's some information from my memory that might be relevant to the current query:\n"
                            f"{formatted_memories}\n\n"
                            "--- User's current message ---\n"
                        )
                        app.logger.info(f"[CHAT_MEMORY_PROACTIVE] Retrieved {len(retrieved_memory_contents)} memories. Context length: {len(proactively_retrieved_memory_context)}")
                    else:
                        app.logger.info(f"[CHAT_MEMORY_PROACTIVE] No proactive memories found for user {user_id}.")
                except Exception as e:
                    app.logger.error(f"[CHAT_MEMORY_PROACTIVE] Error retrieving proactive memories for user {user_id}: {e}", exc_info=True)
                
                message_to_agent = proactively_retrieved_memory_context + user_message_original
                
                # Pass current_user.id (as string) for user-specific memory and agent call
                async for chunk in run_simple_agent(
                    message_to_agent, # Use the potentially augmented message
                    history,
                    user_id=user_id # user_id is already a string here
                ):
                    if chunk.get('type') == 'content':
                        if 'delta' in chunk:
                            final_output += chunk['delta']
                        elif 'result' in chunk:
                            try:
                                parsed = json.loads(chunk['result'])
                                if 'content' in parsed:
                                    final_output = parsed['content']
                                if 'steps' in parsed:
                                    steps = parsed['steps']
                            except:
                                pass
                    elif chunk.get('type') in ['tool', 'tool_result']:
                        steps.append(chunk)
                return {
                    'final_output': final_output,
                    'steps': steps,
                    'suggestions': []
                }

            task = loop.create_task(collect_results())
            result = loop.run_until_complete(task)
        except asyncio.CancelledError:
            # On cancellation, ensure task is properly cancelled
            if task and not task.done():
                task.cancel()
                try:
                    loop.run_until_complete(task)
                except asyncio.CancelledError:
                    pass

            # Return response with conversation ID preserved
            return jsonify({
                'response': 'Request cancelled by user.',
                'conv_id': conv_id,
                'suggestions': [],
                'steps': 0,
                'tool_calls': []
            })
        finally:
            if task and not task.done():
                task.cancel()
                try:
                    loop.run_until_complete(task)
                except asyncio.CancelledError:
                    pass

        # Extract tool calls for debugging
        steps_list = result.get('steps', [])
        tool_calls = []
        for idx, step in enumerate(steps_list):
            if step.get('type') == 'tool':
                name = step.get('name')
                inp = step.get('input')
                output_raw = None
                # check for matching tool_result
                if idx + 1 < len(steps_list) and steps_list[idx + 1].get(
                        'type') == 'tool_result' and steps_list[idx + 1].get(
                            'name') == name:
                    output_raw = steps_list[idx + 1].get('output')
                # ensure JSON-serializable
                if not isinstance(
                        output_raw,
                    (str, int, float, bool, list, dict, type(None))):
                    output = str(output_raw)
                else:
                    output = output_raw
                tool_calls.append({
                    'tool_name': name,
                    'input': inp,
                    'output': output
                })

        # Return the agent's response and debug info
        final_output = result.get(
            'final_output', result.get('response', 'No response available'))
        db.execute(
            'INSERT INTO messages (conv_id, role, content) VALUES (?, ?, ?)',
            (conv_id, 'assistant', final_output))
        db.commit()
        return jsonify({
            'conv_id': conv_id,
            'response': final_output,
            'steps': len(result['steps']),
            'tool_calls': tool_calls,
            'suggestions': result.get('suggestions', [])
        })
    except Exception as e:
        # Handle any errors with detailed logging
        import traceback
        error_traceback = traceback.format_exc()
        print(f"ERROR in /chat route: {str(e)}")
        print(error_traceback)

        return jsonify({
            'response': f"Sorry, an error occurred: {str(e)}",
            'error': str(e)
        }), 500
    finally:
        loop.close()


@app.route('/chat_responses', methods=['POST'])
@login_required
def chat_responses():
    data = request.json

    conv_id = data.get('conv_id')
    db = get_db()
    if not conv_id:
        # Create new conversation
        cur = db.execute('INSERT INTO conversations DEFAULT VALUES')
        conv_id = cur.lastrowid
        db.commit()
        # Generate a title for the new conversation (reuse chat for title)
        try:
            openai_client = openai.OpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""))
            title_resp = openai_client.chat.completions.create(
                model='gpt-4.1-nano',
                messages=[{
                    'role':
                    'system',
                    'content':
                    'You are an assistant that generates concise conversation titles.'
                }, {
                    'role':
                    'user',
                    'content':
                    f"Generate a short title (max 5 words) for a conversation starting with: {data.get('message','')}"
                }])
            title = title_resp.choices[0].message.content.strip()
        except Exception:
            title = f"Conversation {conv_id}"
        db.execute('UPDATE conversations SET title = ? WHERE id = ?',
                   (title, conv_id))
        db.commit()
    # Insert user message
    db.execute(
        'INSERT INTO messages (conv_id, role, content) VALUES (?, ?, ?)',
        (conv_id, 'user', data.get('message', '')))
    db.commit()
    prev_response_id = data.get('prev_response_id')
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        print(
            f"Processing chat_responses request with message: {data.get('message','')[:50]}..."
        )
        result = loop.run_until_complete(
            run_responses_agent(data.get('message', ''), prev_response_id))

        # Extract tool calls for debugging
        steps_list = result.get('steps', [])
        tool_calls = []
        for idx, step in enumerate(steps_list):
            if step.get('type') == 'tool':
                name = step.get('name')
                inp = step.get('input')
                output_raw = None
                # check for matching tool_result
                if idx + 1 < len(steps_list) and steps_list[idx + 1].get(
                        'type') == 'tool_result' and steps_list[idx + 1].get(
                            'name') == name:
                    output_raw = steps_list[idx + 1].get('output')
                # ensure JSON-serializable
                if not isinstance(
                        output_raw,
                    (str, int, float, bool, list, dict, type(None))):
                    output = str(output_raw)
                else:
                    output = output_raw
                tool_calls.append({
                    'tool_name': name,
                    'input': inp,
                    'output': output
                })

        db.execute(
            'INSERT INTO messages (conv_id, role, content) VALUES (?, ?, ?)',
            (conv_id, 'assistant', result['final_output']))
        db.commit()
        return jsonify({
            'conv_id': conv_id,
            'response': result['final_output'],
            'steps': len(result['steps']),
            'tool_calls': tool_calls,
            'response_id': result['response_id']
        })
    except Exception as e:
        import traceback
        error_traceback = traceback.format_exc()
        print(f"ERROR in /chat_responses route: {str(e)}")
        print(error_traceback)

        return jsonify({
            'response': f"Sorry, an error occurred: {str(e)}",
            'error': str(e)
        }), 500
    finally:
        loop.close()

@app.route('/api/interrupt', methods=['POST'])
@login_required
def interrupt_agent():
    """Interrupt an ongoing agent task."""
    try:
        data = request.get_json()
        conv_id = data.get('conv_id')
        
        # For now, we just acknowledge the interrupt
        # The actual interruption happens client-side by canceling the reader
        return jsonify({
            'success': True,
            'message': 'Interrupt signal sent'
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/typeahead_suggestions', methods=['POST'])
@login_required # Ensures only authenticated users can get suggestions
async def typeahead_suggestions():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Missing JSON payload"}), 400

    agent_previous_message = data.get('agent_previous_message')
    user_current_input = data.get('user_current_input')

    # Ensure both fields are present.
    # agent_previous_message can be empty (e.g. start of conversation).
    # user_current_input can be empty, but neither should be None.
    if agent_previous_message is None or user_current_input is None:
        return jsonify({"error": "Request must include 'agent_previous_message' and 'user_current_input'"}), 400

    try:
        # Since app.py routes are typically synchronous unless specifically
        # designed for async frameworks like Quart, and Flask doesn't
        # natively support async route handlers without extensions like Flask-Async,
        # we might need to run the async function in a separate event loop.
        # However, Uvicorn with WSGIMiddleware can handle some async tasks.
        # Let's assume for now your Uvicorn setup can manage this.
        # If not, we'd use asyncio.run() or run_in_executor.
        suggestions = await generate_typeahead_suggestions(
            agent_previous_message=agent_previous_message,
            user_current_input=user_current_input
        )
        return jsonify({"suggestions": suggestions}), 200
    except Exception as e:
        app.logger.error(f"Error in /api/typeahead_suggestions: {str(e)}")
        # import traceback # For debugging if needed
        # app.logger.error(traceback.format_exc()) # For debugging
        return jsonify({"error": "Failed to generate typeahead suggestions"}), 500

@app.route('/conversations', methods=['GET'])
@login_required
def list_conversations():
    # Fetch conversations for the currently logged-in user
    user_conversations = Conversation.query.filter_by(
        user_id=current_user.id).order_by(
            Conversation.created_at.desc()).all()
    return jsonify([{
        'id':
        conv.id,
        'title':
        conv.title,
        'created_at':
        conv.created_at.isoformat() if conv.created_at else None
    } for conv in user_conversations])


@app.route('/conversations/<int:conv_id>', methods=['GET'])
@login_required
def get_conversation(conv_id):
    # First, get the conversation and verify it belongs to the current user
    conversation = Conversation.query.filter_by(
        id=conv_id, user_id=current_user.id).first_or_404()

    # Then, get all messages for that conversation, ordered by creation time
    messages = Message.query.filter_by(conv_id=conversation.id).order_by(
        Message.created_at.asc()).all()

    return jsonify([{
        'role':
        msg.role,
        'content':
        msg.content,
        'timestamp':
        msg.created_at.isoformat() if msg.created_at else None,
        'tool_call_id':
        msg.tool_call_id,
        'tool_name':
        msg.tool_name
    } for msg in messages])





@app.route('/conversations/<int:conv_id>', methods=['DELETE'])
@login_required
def delete_conversation(conv_id):
    # Ensure Conversation, db, current_user, and jsonify are imported/available in this scope.
    # e.g., from models import Conversation
    # from extensions import db
    # from flask_login import current_user
    # from flask import jsonify

    conversation = Conversation.query.filter_by(
        id=conv_id, user_id=current_user.id).first_or_404()

    # Messages associated with this conversation will be deleted automatically
    # due to the cascade="all, delete-orphan" setting in the Conversation.messages relationship.
    db.session.delete(conversation)
    db.session.commit()

    return jsonify({
        'message':
        f'Conversation {conv_id} and its messages deleted successfully.'
    }), 200


@app.route('/execute_code', methods=['POST'])
@login_required
def execute_code_endpoint():

    # Import the code interpreter module
    from code_interpreter import execute_code

    data = request.json
    code = data.get('code', '')

    if not code:
        return jsonify({"error": "No code provided"}), 400

    # Execute the code with a timeout
    execution_result = execute_code(code, timeout=5)

    # Store the code execution in the database if requested
    if data.get('store_in_conversation', False) and data.get('conv_id'):
        conv_id = data.get('conv_id')
        db = get_db()

        # Store the code as a user message
        db.execute(
            'INSERT INTO messages (conv_id, role, content) VALUES (?, ?, ?)',
            (conv_id, 'user', f"```python\n{code}\n```"))

        # Store the result as an assistant message
        output = execution_result.get('output', '')
        error = execution_result.get('error', '')
        result_content = f"```\n{output}\n```"
        if error:
            result_content += f"\n\nError:\n```\n{error}\n```"

        db.execute(
            'INSERT INTO messages (conv_id, role, content) VALUES (?, ?, ?)',
            (conv_id, 'assistant', result_content))
        db.commit()

    return jsonify(execution_result)


# --- Google Tasks Integration Routes ---


@app.route('/api/authorize/google', methods=['GET'])
@login_required
def authorize_google():
    """Start the Google OAuth flow"""
    # Create a flow instance
    flow = google_tasks.get_flow()

    # Generate URL for authorization request
    authorization_url, state = flow.authorization_url(
        access_type='offline',
        include_granted_scopes='false',  # Don't include additional scopes
        prompt='consent',  # Always prompt to ensure we get refresh token
        login_hint=current_user.email if current_user.email else None
    )

    # Store the state in the session
    session['state'] = state
    session['user_id'] = current_user.id

    print(f"Starting OAuth flow for user {current_user.id} with state {state}")
    print(f"Redirecting to: {authorization_url}")

    # Redirect to the authorization URL
    return redirect(authorization_url)


@app.route('/api/google/callback', methods=['GET'])
def google_auth_callback():
    """Handle the Google OAuth callback"""
    # Verify state parameter
    state = session.get('state')
    if not state or state != request.args.get('state'):
        print(f"State mismatch: session state={state}, request state={request.args.get('state')}")
        return jsonify({"error": "Invalid state parameter. Please try authorizing again."}), 400

    user_id = session.get('user_id')
    if not user_id:
        return jsonify({"error": "No user ID in session. Please log in again."}), 400

    try:
        # Get the authorization flow
        flow = google_tasks.get_flow()

        # Use the authorization code to get the credentials
        # Ensure URL is secure for OAuth purposes
        auth_response = request.url
        if auth_response.startswith('http:'):
            auth_response = 'https:' + auth_response[5:]

        # Handle scope mismatch by setting validate_scope to False
        # This allows the flow to continue even if Google returns different scopes
        flow.fetch_token(authorization_response=auth_response, validate_scope=False)
        credentials = flow.credentials

        # Save the credentials for this user
        google_tasks.save_credentials(user_id, credentials)

        # Clear the session state
        session.pop('state', None)

        # Redirect to the tasks page
        return redirect('/tasks')
    except Exception as e:
        print(f"Error in OAuth callback: {str(e)}")
        return jsonify({"error": f"Authentication error: {str(e)}"}), 500


@app.route('/api/tasks/auth_status', methods=['GET'])
@login_required
def check_tasks_auth():
    """Check if the user has authorized Google Tasks"""
    return jsonify(
        {"is_authorized": google_tasks.is_authorized(current_user.id)})


@app.route('/api/tasks/lists', methods=['GET'])
@login_required
def get_task_lists():
    """Get all task lists for the user"""
    if not google_tasks.is_authorized(current_user.id):
        return jsonify({"error": "Not authorized with Google Tasks"}), 401

    task_lists = google_tasks.get_task_lists(current_user.id)
    return jsonify(task_lists)


@app.route('/api/tasks', methods=['GET'])
@login_required
def get_tasks():
    """Get all tasks for a task list"""
    if not google_tasks.is_authorized(current_user.id):
        return jsonify({"error": "Not authorized with Google Tasks"}), 401

    tasklist_id = request.args.get('tasklist_id', '@default')
    tasks = google_tasks.get_tasks(current_user.id, tasklist_id)
    return jsonify(tasks)


@app.route('/api/tasks', methods=['POST'])
@login_required
def create_task():
    """Create a new task"""
    if not google_tasks.is_authorized(current_user.id):
        return jsonify({"error": "Not authorized with Google Tasks"}), 401

    data = request.json
    title = data.get('title')
    if not title:
        return jsonify({"error": "Title is required"}), 400

    notes = data.get('notes')
    due = data.get('due')
    tasklist_id = data.get('tasklist_id', '@default')

    result = google_tasks.create_task(current_user.id,
                                      title,
                                      notes=notes,
                                      due=due,
                                      tasklist_id=tasklist_id)

    return jsonify(result)


@app.route('/api/tasks/<task_id>', methods=['PUT'])
@login_required
def update_task(task_id):
    """Update an existing task"""
    if not google_tasks.is_authorized(current_user.id):
        return jsonify({"error": "Not authorized with Google Tasks"}), 401

    data = request.json
    title = data.get('title')
    notes = data.get('notes')
    due = data.get('due')
    status = data.get('status')
    tasklist_id = data.get('tasklist_id', '@default')

    result = google_tasks.update_task(current_user.id,
                                      task_id,
                                      title=title,
                                      notes=notes,
                                      due=due,
                                      status=status,
                                      tasklist_id=tasklist_id)

    return jsonify(result)


@app.route('/api/tasks/<task_id>', methods=['DELETE'])
@login_required
def delete_task(task_id):
    """Delete a task"""
    if not google_tasks.is_authorized(current_user.id):
        return jsonify({"error": "Not authorized with Google Tasks"}), 401

    tasklist_id = request.args.get('tasklist_id', '@default')
    result = google_tasks.delete_task(current_user.id, task_id, tasklist_id)
    return jsonify(result)


@app.route('/api/tasks/<task_id>/complete', methods=['POST'])
@login_required
def complete_task(task_id):
    """Mark a task as completed"""
    if not google_tasks.is_authorized(current_user.id):
        return jsonify({"error": "Not authorized with Google Tasks"}), 401

    tasklist_id = request.args.get('tasklist_id', '@default')
    result = google_tasks.complete_task(current_user.id, task_id, tasklist_id)
    return jsonify(result)


@app.route('/tasks', methods=['GET'])
@login_required
def tasks_page():
    """Serve the tasks page"""
    # This will render the React frontend, which will handle the tasks UI
    return app.send_static_file('index.html')

# Helper function to ensure user storage directories exist
def ensure_user_storage_dirs(user_id):
    """Create user-specific storage directories if they don't exist"""
    if not user_id:
        return

    base_dir = os.path.dirname(os.path.abspath(__file__))
    user_dir = os.path.join(base_dir, 'storage', 'users', str(user_id))
    user_exports_dir = os.path.join(user_dir, 'exports')

    # Create directories with proper permissions
    for directory in [user_dir, user_exports_dir]:
        if not os.path.exists(directory):
            os.makedirs(directory, exist_ok=True)

    return user_exports_dir

@app.route('/api/exports/<path:filename>', methods=['GET'])
@login_required
def get_export_file(filename):
    """Serve files from the exports directory, using user-specific directories"""
    # Ensure we're only accessing files in the exports directory
    if '..' in filename or filename.startswith('/'):
        return jsonify({"error": "Invalid filename"}), 400

    # Base exports directory
    base_dir = os.path.dirname(os.path.abspath(__file__))

    # First check if file exists in user-specific directory
    user_exports_dir = os.path.join(base_dir, 'storage', 'users', str(current_user.id), 'exports')
    user_file_path = os.path.join(user_exports_dir, filename)

    # If not in user directory, check the shared exports directory (for backward compatibility)
    shared_exports_dir = os.path.join(base_dir, 'storage', 'exports')
    shared_file_path = os.path.join(shared_exports_dir, filename)

    # Determine which path to use
    if os.path.exists(user_file_path) and os.path.isfile(user_file_path):
        file_path = user_file_path
    elif os.path.exists(shared_file_path) and os.path.isfile(shared_file_path):
        file_path = shared_file_path
    else:
        return jsonify({"error": "File not found"}), 404

    # Determine content type (optional - can be expanded)
    content_type = 'application/octet-stream'  # default
    if filename.endswith('.csv'):
        content_type = 'text/csv'
    elif filename.endswith('.json'):
        content_type = 'application/json'
    elif filename.endswith('.txt'):
        content_type = 'text/plain'

    # Return the file
    with open(file_path, 'rb') as f:
        file_data = f.read()

    # Send file as response
    from flask import send_file
    from io import BytesIO
    return send_file(
        BytesIO(file_data),
        mimetype=content_type,
        as_attachment=True,
        download_name=filename
    )



# Wrap the Flask app with WSGIMiddleware to make it an ASGI application for Uvicorn
# The original Flask 'app' instance needs to remain accessible for Flask CLI tools.
application = WSGIMiddleware(app)

if __name__ == '__main__':
    # Show environment status
    api_key = os.environ.get('OPENAI_API_KEY')
    shopify_url = os.environ.get('SHOPIFY_SHOP_URL')
    
    # Set default BASE_URL if not provided
    if 'BASE_URL' not in os.environ:
        # For local development, use the server URL
        is_replit = os.environ.get('REPL_ID') is not None
        if is_replit:
            # In Replit, use the REPL_SLUG for the URL
            repl_slug = os.environ.get('REPL_SLUG', '')
            repl_owner = os.environ.get('REPL_OWNER', '')
            if repl_slug and repl_owner:
                os.environ['BASE_URL'] = f"https://{repl_slug}.{repl_owner}.repl.co"
            else:
                os.environ['BASE_URL'] = ""
        else:
            # For local development
            os.environ['BASE_URL'] = "http://0.0.0.0:5000"
    
    print(f"Base URL for file downloads: {os.environ.get('BASE_URL')}")

    if not api_key:
        print(
            "⚠️ Warning: OPENAI_API_KEY environment variable not set. Agent will not function properly."
        )
    if not shopify_url:
        print(
            "⚠️ Warning: SHOPIFY_SHOP_URL environment variable not set. Agent will not function properly."
        )

    # Run the ASGI application with Uvicorn
    # FLASK_DEBUG=1 will enable debug mode including hot-reloading for Uvicorn
    debug_mode = os.environ.get('FLASK_DEBUG') == '1'
    uvicorn.run(
        "app:application",  # Path to the ASGI app object (app.py -> application variable)
        host='0.0.0.0',
        port=5000,
        log_level="debug" if debug_mode else "info",
        reload=debug_mode # Enable auto-reload if in debug mode
    )