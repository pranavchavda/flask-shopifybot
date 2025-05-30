import os
import json
import datetime
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from flask import url_for
from google.auth.transport.requests import Request as GoogleAuthRequest

# Allow OAuth over HTTP for development
# WARNING: This should never be enabled in production
os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'

# Google Tasks API scopes
SCOPES = [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/tasks',
    'openid'  # Including OpenID scope which seems to be added automatically by Google OAuth
]


def get_credentials_path(user_id):
    """Get the path to store user's Google credentials"""
    credentials_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                   'storage', 'credentials')
    os.makedirs(credentials_dir, exist_ok=True)
    return os.path.join(credentials_dir,
                        f'google_tasks_credentials_{user_id}.json')


def get_flow():
    """Create OAuth flow object for Google Tasks API"""
    client_id = os.environ.get("GOOGLE_CLIENT_ID")
    client_secret = os.environ.get("GOOGLE_CLIENT_SECRET")

    if not client_id or not client_secret:
        raise RuntimeError("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in environment variables.")

    client_config = {
        "web": {
            "client_id": client_id,
            "client_secret": client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token"
        }
    }

    # Prefer FRONTEND_ORIGIN for redirect, fallback to espressobot.replit.app, then localhost:5000
    frontend_origin = os.environ.get("FRONTEND_ORIGIN")
    port = os.environ.get("PORT")
    if frontend_origin and "localhost" in frontend_origin:
        frontend_origin = frontend_origin.rstrip("/")
        redirect_uri = f"{frontend_origin}/api/google/callback"
    elif frontend_origin:
        redirect_uri = "https://node.idrinkcoffee.info/api/google/callback"
    # elif port:
    #     redirect_uri = f"http://localhost:{port}/api/google/callback"
    else:
        redirect_uri = "http://localhost:2000/api/google/callback"

    print(f"Using redirect URI: {redirect_uri}")

    flow = Flow.from_client_config(
        client_config,
        scopes=SCOPES,
        redirect_uri=redirect_uri
    )
    return flow


def get_credentials(user_id):
    """Get stored credentials for the user or return None"""
    creds_path = get_credentials_path(user_id)
    if not os.path.exists(creds_path):
        return None

    with open(creds_path, 'r') as f:
        creds_data = json.load(f)
        creds = Credentials.from_authorized_user_info(creds_data)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            # Refresh the token
            creds.refresh(GoogleAuthRequest())
            # Save refreshed credentials
            with open(creds_path, 'w') as f:
                f.write(creds.to_json())
        else:
            return None

    return creds


def save_credentials(user_id, credentials):
    """Save credentials to a file"""
    creds_path = get_credentials_path(user_id)
    with open(creds_path, 'w') as f:
        f.write(credentials.to_json())


def is_authorized(user_id):
    """Check if the user has authorized Google Tasks"""
    return get_credentials(user_id) is not None


def get_service(user_id):
    """Get a Google Tasks service object for the user"""
    creds = get_credentials(user_id)
    if not creds:
        return None
    return build('tasks', 'v1', credentials=creds)


def get_task_lists(user_id):
    """Get all task lists for the user"""
    service = get_service(user_id)
    if not service:
        return {"error": "Not authorized"}

    try:
        results = service.tasklists().list().execute()
        return results.get('items', [])
    except Exception as e:
        return {"error": str(e)}


def get_tasks(user_id, tasklist_id='@default', showAssigned=True):
    """Get all tasks in a task list"""
    service = get_service(user_id)
    if not service:
        return {"error": "Not authorized"}

    try:
        results = service.tasks().list(tasklist=tasklist_id, showAssigned=showAssigned).execute()
        return results.get('items', [])
    except Exception as e:
        return {"error": str(e)}


def create_task(user_id, title, notes=None, due=None, tasklist_id='@default'):
    """Create a new task"""
    service = get_service(user_id)
    if not service:
        return {"error": "Not authorized"}

    task = {
        'title': title,
    }

    if notes:
        task['notes'] = notes

    if due:
        # Format date as RFC 3339 timestamp
        if isinstance(due, str):
            # Try to parse the string as a date
            try:
                due_date = datetime.datetime.strptime(due, "%Y-%m-%d")
                due = due_date.isoformat() + 'Z'  # 'Z' indicates UTC time
            except ValueError:
                # If parsing fails, use the string as is
                pass
        elif isinstance(due, datetime.datetime):
            due = due.isoformat() + 'Z'

        task['due'] = due

    try:
        result = service.tasks().insert(tasklist=tasklist_id,
                                        body=task).execute()
        return result
    except Exception as e:
        return {"error": str(e)}


def update_task(user_id,
                task_id,
                title=None,
                notes=None,
                due=None,
                status=None,
                tasklist_id='@default'):
    """Update an existing task"""
    service = get_service(user_id)
    if not service:
        return {"error": "Not authorized"}

    # First get the existing task to update only provided fields
    try:
        task = service.tasks().get(tasklist=tasklist_id,
                                   task=task_id).execute()
    except Exception as e:
        return {"error": f"Task not found: {str(e)}"}

    if title:
        task['title'] = title
    if notes:
        task['notes'] = notes
    if status in ['needsAction', 'completed']:
        task['status'] = status
        # When changing status to needsAction (unchecking), we need to remove completed date
        if status == 'needsAction' and 'completed' in task:
            del task['completed']

    if due:
        # Format date as RFC 3339 timestamp
        if isinstance(due, str):
            # Try to parse the string as a date
            try:
                due_date = datetime.datetime.strptime(due, "%Y-%m-%d")
                due = due_date.isoformat() + 'Z'  # 'Z' indicates UTC time
            except ValueError:
                # If parsing fails, use the string as is
                pass
        elif isinstance(due, datetime.datetime):
            due = due.isoformat() + 'Z'

        task['due'] = due

    try:
        result = service.tasks().update(tasklist=tasklist_id,
                                        task=task_id,
                                        body=task).execute()
        return result
    except Exception as e:
        return {"error": str(e)}


def delete_task(user_id, task_id, tasklist_id='@default'):
    """Delete a task"""
    service = get_service(user_id)
    if not service:
        return {"error": "Not authorized"}

    try:
        service.tasks().delete(tasklist=tasklist_id, task=task_id).execute()
        return {"success": True}
    except Exception as e:
        return {"error": str(e)}


def complete_task(user_id, task_id, tasklist_id='@default'):
    """Mark a task as completed"""
    return update_task(user_id,
                       task_id,
                       status='completed',
                       tasklist_id=tasklist_id)
