from flask import Flask, request, render_template, jsonify
import os
import asyncio
from simple_agent import run_simple_agent, client as openai_client
from responses_agent import run_responses_agent
from dotenv import load_dotenv
from database import init_db, get_db, close_db

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__, template_folder="templates")
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'devsecret')  # Needed for session
app.teardown_appcontext(close_db)
with app.app_context():
    init_db()

from flask import session, redirect, url_for

PASSWORD = os.environ.get("CHAT_PASSWORD", "letmein")

@app.route('/', methods=['GET', 'POST'])
def home():
    if 'authenticated' not in session:
        if request.method == 'POST':
            pw = request.form.get('password', '')
            if pw == PASSWORD:
                session['authenticated'] = True
                return redirect(url_for('home'))
            else:
                return render_template('password.html', error='Incorrect password!')
        return render_template('password.html', error=None)
    # Render the main chat interface
    return render_template('index.html')
@app.route('/responses', methods=['GET', 'POST'])
def responses_ui():
    if 'authenticated' not in session:
        if request.method == 'POST':
            pw = request.form.get('password', '')
            if pw == PASSWORD:
                session['authenticated'] = True
                return redirect(url_for('responses_ui'))
            else:
                return render_template('password.html', error='Incorrect password!')
        return render_template('password.html', error=None)
    # Serve the UI pointing to the Responses API
    template_path = os.path.join(app.template_folder, 'index.html')
    with open(template_path, 'r') as f:
        html = f.read()
    # Replace client fetch call from /chat to /chat_responses
    html = html.replace("fetch('/chat'", "fetch('/chat_responses'")
    return html

@app.route('/chat', methods=['POST'])
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
            title_resp = openai_client.chat.completions.create(
                model=os.environ.get('DEFAULT_MODEL', 'gpt-4.1-nano'),
                messages=[
                    {'role': 'system', 'content': 'You are an assistant that generates concise conversation titles.'},
                    {'role': 'user', 'content': f"Generate a short title (max 5 words) for a conversation starting with: {data.get('message','')}"}
                ]
            )
            title = title_resp.choices[0].message.content.strip()
        except Exception:
            title = f"Conversation {conv_id}"
        db.execute('UPDATE conversations SET title = ? WHERE id = ?', (title, conv_id))
        db.commit()
    db.execute(
        'INSERT INTO messages (conv_id, role, content) VALUES (?, ?, ?)',
        (conv_id, 'user', data.get('message', ''))
    )
    db.commit()
    rows = db.execute(
        'SELECT role, content FROM messages WHERE conv_id = ? ORDER BY id',
        (conv_id,)
    ).fetchall()
    history = [{'role': r['role'], 'content': r['content']} for r in rows]
    
    # Run the agent in an async loop
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    # Create a task that can be cancelled
    task = None
    try:
        print(f"Processing chat request with message: {data.get('message','')[:50]}...")
        task = loop.create_task(run_simple_agent(data.get('message',''), history))
        
        try:
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
        tool_calls = []
        for step in result['steps']:
            if 'tool call' in step['step'].lower():
                tool_calls.append({
                    'tool_name': step['step'].split(':')[-1].strip() if ':' in step['step'] else step['step'],
                    'input': step['input'],
                    'output': step.get('output', None)
                })
        
        # Return the agent's response and debug info
        db.execute(
            'INSERT INTO messages (conv_id, role, content) VALUES (?, ?, ?)',
            (conv_id, 'assistant', result['final_output'])
        )
        db.commit()
        return jsonify({
            'conv_id': conv_id,
            'response': result['final_output'],
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
            title_resp = openai_client.chat.completions.create(
                model=os.environ.get('DEFAULT_MODEL', 'gpt-4.1-nano'),
                messages=[
                    {'role': 'system', 'content': 'You are an assistant that generates concise conversation titles.'},
                    {'role': 'user', 'content': f"Generate a short title (max 5 words) for a conversation starting with: {data.get('message','')}"}
                ]
            )
            title = title_resp.choices[0].message.content.strip()
        except Exception:
            title = f"Conversation {conv_id}"
        db.execute('UPDATE conversations SET title = ? WHERE id = ?', (title, conv_id))
        db.commit()
    # Insert user message
    db.execute(
        'INSERT INTO messages (conv_id, role, content) VALUES (?, ?, ?)',
        (conv_id, 'user', data.get('message', ''))
    )
    db.commit()
    prev_response_id = data.get('prev_response_id')
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        print(f"Processing chat_responses request with message: {data.get('message','')[:50]}...")
        result = loop.run_until_complete(run_responses_agent(data.get('message',''), prev_response_id))

        # Extract tool calls for debugging
        tool_calls = []
        for step in result['steps']:
            if 'tool call' in step['step'].lower():
                tool_calls.append({
                    'tool_name': step['step'].split(':')[-1].strip() if ':' in step['step'] else step['step'],
                    'input': step['input'],
                    'output': step.get('output', None)
                })

        db.execute(
            'INSERT INTO messages (conv_id, role, content) VALUES (?, ?, ?)',
            (conv_id, 'assistant', result['final_output'])
        )
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


@app.route('/conversations', methods=['GET'])
def list_conversations():
    db = get_db()
    convs = db.execute(
        'SELECT id, title, created_at FROM conversations ORDER BY created_at DESC'
    ).fetchall()
    return jsonify([
        {'id': c['id'], 'title': c['title'], 'created_at': c['created_at']} for c in convs
    ])

@app.route('/conversations/<int:conv_id>', methods=['GET'])
def get_conversation(conv_id):
    db = get_db()
    rows = db.execute(
        'SELECT role, content, timestamp FROM messages WHERE conv_id = ? ORDER BY id',
        (conv_id,)
    ).fetchall()
    return jsonify([{'role': r['role'], 'content': r['content'], 'timestamp': r['timestamp']} for r in rows])

@app.route('/conversations/<int:conv_id>', methods=['DELETE'])
def delete_conversation(conv_id):
    db = get_db()
    db.execute('DELETE FROM messages WHERE conv_id = ?', (conv_id,))
    db.execute('DELETE FROM conversations WHERE id = ?', (conv_id,))
    db.commit()
    return ('', 204)

if __name__ == '__main__':
    # Show environment status
    api_key = os.environ.get('OPENAI_API_KEY')
    shopify_url = os.environ.get('SHOPIFY_SHOP_URL')
    
    if not api_key:
        print("⚠️ Warning: OPENAI_API_KEY environment variable not set. Agent will not function properly.")
    if not shopify_url:
        print("⚠️ Warning: SHOPIFY_SHOP_URL environment variable not set. Agent will not function properly.")
    
    print(f"Starting Flask application with Shopify Agent for shop: {shopify_url or 'NOT SET'}")
    
    # Run the Flask application
    app.run(debug=True, port=5000)
