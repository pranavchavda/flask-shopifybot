"""
SQLite-based Task Management System
Fast, local storage without embeddings for real-time task tracking.
"""

import sqlite3
import json
import uuid
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime
import os

logger = logging.getLogger(__name__)

class SQLiteTaskManager:
    """
    Lightweight task management using SQLite for speed.
    No embeddings, no vector storage - just fast CRUD operations.
    """
    
    def __init__(self, db_path: str = None):
        if db_path is None:
            db_path = os.path.join(os.path.dirname(__file__), 'tasks.db')
        self.db_path = db_path
        self._init_db()
    
    def _init_db(self):
        """Initialize the SQLite database with required tables."""
        with sqlite3.connect(self.db_path) as conn:
            # Create base tables if they don't exist yet
            conn.execute('''
                CREATE TABLE IF NOT EXISTS task_lists (
                    id TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    title TEXT NOT NULL,
                    template_name TEXT,
                    status TEXT DEFAULT 'active',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            conn.execute('''
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY,
                    task_list_id TEXT NOT NULL,
                    content TEXT NOT NULL,
                    status TEXT DEFAULT 'pending',
                    priority TEXT DEFAULT 'medium',
                    order_index INTEGER DEFAULT 0,
                    parent_id TEXT,
                    subtasks TEXT,  -- JSON array of subtasks
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (task_list_id) REFERENCES task_lists (id)
                )
            ''')
            
            # Create tasks table for persistence
            conn.execute('''
                CREATE TABLE IF NOT EXISTS persisted_tasks (
                    id INTEGER PRIMARY KEY,
                    task_id TEXT,
                    conversation_id INTEGER,
                    user_id INTEGER,
                    text TEXT NOT NULL,
                    active INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # Check if task_id column exists in persisted_tasks
            cursor = conn.execute("PRAGMA table_info(persisted_tasks)")
            columns = [info[1] for info in cursor.fetchall()]
            if 'task_id' not in columns:
                conn.execute('''
                    ALTER TABLE persisted_tasks 
                    ADD COLUMN task_id TEXT
                ''')
                
            # Create index for persisted_tasks
            conn.execute('''
                CREATE INDEX IF NOT EXISTS idx_persisted_tasks_task_id ON persisted_tasks (task_id)
            ''')
            
            conn.execute('''
                CREATE INDEX IF NOT EXISTS idx_persisted_tasks_conversation_id ON persisted_tasks (conversation_id)
            ''')
            
            # Check if conversation_id column exists, add it if it doesn't
            cursor = conn.execute("PRAGMA table_info(task_lists)")
            columns = [info[1] for info in cursor.fetchall()]
            if 'conversation_id' not in columns:
                print("Adding conversation_id column to task_lists table...")
                conn.execute('''
                    ALTER TABLE task_lists 
                    ADD COLUMN conversation_id INTEGER
                ''')
            
            # Create indices after ensuring the columns exist
            conn.execute('''
                CREATE INDEX IF NOT EXISTS idx_task_lists_user_id ON task_lists (user_id)
            ''')
            
            conn.execute('''
                CREATE INDEX IF NOT EXISTS idx_task_lists_conversation_id ON task_lists (conversation_id)
            ''')
            
            conn.execute('''
                CREATE INDEX IF NOT EXISTS idx_tasks_task_list_id ON tasks (task_list_id)
            ''')
            
            conn.commit()
    
    async def create_task_list(self, user_id: int, title: str, tasks: List[Dict], template_name: str = None, conversation_id: int = None) -> Dict[str, Any]:
        """Create a new task list with tasks."""
        task_list_id = str(uuid.uuid4())
        
        try:
            with sqlite3.connect(self.db_path) as conn:
                # Create task list
                conn.execute('''
                    INSERT INTO task_lists (id, user_id, conversation_id, title, template_name)
                    VALUES (?, ?, ?, ?, ?)
                ''', (task_list_id, user_id, conversation_id, title, template_name))
                
                # Clear any existing active task lists for this user and conversation
                if conversation_id is not None:
                    # If conversation_id is provided, only deactivate tasks in that conversation
                    conn.execute('''
                        UPDATE task_lists 
                        SET status = 'completed' 
                        WHERE user_id = ? AND conversation_id = ? AND id != ? AND status = 'active'
                    ''', (user_id, conversation_id, task_list_id))
                else:
                    # If no conversation_id, fall back to just user_id (backward compatibility)
                    conn.execute('''
                        UPDATE task_lists 
                        SET status = 'completed' 
                        WHERE user_id = ? AND id != ? AND status = 'active'
                    ''', (user_id, task_list_id))
                
                # Create tasks
                for i, task in enumerate(tasks):
                    task_id = str(uuid.uuid4())
                    content = task.get("content", "") if isinstance(task, dict) else str(task)
                    subtasks = json.dumps(task.get("subtasks", [])) if isinstance(task, dict) and "subtasks" in task else None
                    
                    conn.execute('''
                        INSERT INTO tasks (id, task_list_id, content, order_index, subtasks)
                        VALUES (?, ?, ?, ?, ?)
                    ''', (task_id, task_list_id, content, i, subtasks))
                
                conn.commit()
                
                # Count tasks
                cursor = conn.execute('SELECT COUNT(*) FROM tasks WHERE task_list_id = ?', (task_list_id,))
                task_count = cursor.fetchone()[0]
                
                return {
                    "success": True,
                    "task_list_id": task_list_id,
                    "task_count": task_count,
                    "message": f"Created task list '{title}' with {task_count} tasks"
                }
                
        except Exception as e:
            logger.error(f"Error creating task list: {e}")
            return {"success": False, "error": str(e)}
    
    async def get_current_task_list(self, user_id: int, conversation_id: int = None) -> Dict[str, Any]:
        """Get the current active task list for a user."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                
                # Get active task list based on user_id and optional conversation_id
                if conversation_id is not None:
                    # If conversation_id is provided, get task list specific to that conversation
                    cursor = conn.execute('''
                        SELECT * FROM task_lists 
                        WHERE user_id = ? AND conversation_id = ? AND status = 'active'
                        ORDER BY created_at DESC 
                        LIMIT 1
                    ''', (user_id, conversation_id))
                else:
                    # If no conversation_id, get most recent active task list for user
                    cursor = conn.execute('''
                        SELECT * FROM task_lists 
                        WHERE user_id = ? AND status = 'active'
                        ORDER BY created_at DESC 
                        LIMIT 1
                    ''', (user_id,))
                
                task_list_row = cursor.fetchone()
                if not task_list_row:
                    return {"success": True, "task_list": None}
                
                task_list = dict(task_list_row)
                
                # Get tasks for this list
                cursor = conn.execute('''
                    SELECT * FROM tasks 
                    WHERE task_list_id = ? 
                    ORDER BY order_index
                ''', (task_list["id"],))
                
                tasks = []
                for task_row in cursor.fetchall():
                    task = dict(task_row)
                    if task["subtasks"]:
                        task["subtasks"] = json.loads(task["subtasks"])
                    tasks.append(task)
                
                task_list["tasks"] = tasks
                
                return {
                    "success": True,
                    "task_list": task_list
                }
                
        except Exception as e:
            logger.error(f"Error getting current task list: {e}")
            return {"success": False, "error": str(e)}
    
    async def update_task_status(self, user_id: int, task_id: str, status: str, conversation_id: int = None) -> Dict[str, Any]:
        """Update the status of a specific task."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                
                # First, get the task details to ensure it exists and to get its content
                if conversation_id is not None:
                    cursor = conn.execute('''
                        SELECT tasks.*, task_lists.conversation_id
                        FROM tasks 
                        JOIN task_lists ON tasks.task_list_id = task_lists.id
                        WHERE tasks.id = ? AND task_lists.user_id = ? AND task_lists.conversation_id = ?
                    ''', (task_id, user_id, conversation_id))
                else:
                    cursor = conn.execute('''
                        SELECT tasks.*, task_lists.conversation_id
                        FROM tasks 
                        JOIN task_lists ON tasks.task_list_id = task_lists.id
                        WHERE tasks.id = ? AND task_lists.user_id = ?
                    ''', (task_id, user_id))
                
                task_row = cursor.fetchone()
                if not task_row:
                    return {"success": False, "error": "Task not found"}
                
                task = dict(task_row)
                task_content = task.get("content", "")
                task_conversation_id = task.get("conversation_id")
                
                # Now update the task status
                cursor = conn.execute('''
                    UPDATE tasks 
                    SET status = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                ''', (status, task_id))
                
                # Add task to persisted tasks if completed
                if status == "done" or status == "completed":
                    # Check if it's already in persisted_tasks
                    cursor = conn.execute('''
                        SELECT id FROM persisted_tasks WHERE task_id = ?
                    ''', (task_id,))
                    
                    if not cursor.fetchone():  # Only insert if not already present
                        conn.execute('''
                            INSERT INTO persisted_tasks (task_id, conversation_id, user_id, text, active)
                            VALUES (?, ?, ?, ?, 0)
                        ''', (task_id, task_conversation_id, user_id, task_content))
                
                conn.commit()
                return {
                    "success": True,
                    "message": f"Task status updated to {status}",
                    "task_id": task_id,
                    "task_content": task_content,
                    "conversation_id": task_conversation_id
                }
                
        except Exception as e:
            logger.error(f"Error updating task status: {e}")
            return {"success": False, "error": str(e)}
    
    async def add_task(self, user_id: int, content: str, priority: str = "medium", parent_id: str = None, conversation_id: int = None) -> Dict[str, Any]:
        """Add a new task to the current task list."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                # Get current task list, filtering by conversation_id if provided
                if conversation_id is not None:
                    # If conversation_id is provided, get task list specific to that conversation
                    cursor = conn.execute('''
                        SELECT id FROM task_lists 
                        WHERE user_id = ? AND conversation_id = ? AND status = 'active'
                        ORDER BY created_at DESC 
                        LIMIT 1
                    ''', (user_id, conversation_id))
                else:
                    # If no conversation_id, get most recent active task list for user
                    cursor = conn.execute('''
                        SELECT id FROM task_lists 
                        WHERE user_id = ? AND status = 'active'
                        ORDER BY created_at DESC 
                        LIMIT 1
                    ''', (user_id,))
                
                task_list_row = cursor.fetchone()
                if not task_list_row:
                    return {"success": False, "error": "No active task list found"}
                
                task_list_id = task_list_row[0]
                
                # Get next order index
                cursor = conn.execute('''
                    SELECT COALESCE(MAX(order_index), -1) + 1 
                    FROM tasks WHERE task_list_id = ?
                ''', (task_list_id,))
                order_index = cursor.fetchone()[0]
                
                # Create new task
                task_id = str(uuid.uuid4())
                conn.execute('''
                    INSERT INTO tasks (id, task_list_id, content, priority, order_index, parent_id)
                    VALUES (?, ?, ?, ?, ?, ?)
                ''', (task_id, task_list_id, content, priority, order_index, parent_id))
                
                conn.commit()
                return {"success": True, "task_id": task_id, "message": "Task added successfully"}
                
        except Exception as e:
            logger.error(f"Error adding task: {e}")
            return {"success": False, "error": str(e)}
    
    async def get_task_context_string(self, user_id: int, conversation_id: int = None) -> str:
        """Get formatted task context for injection into agent prompts."""
        try:
            result = await self.get_current_task_list(user_id, conversation_id)
            if not result.get("success") or not result.get("task_list"):
                return ""
            
            task_list = result["task_list"]
            tasks = task_list.get("tasks", [])
            
            if not tasks:
                return ""
            
            context = f"\n📋 CURRENT TASK LIST: {task_list['title']}\n"
            context += "Tasks (you MUST update status as you work):\n"
            
            for i, task in enumerate(tasks, 1):
                status_icon = {
                    "pending": "⏳",
                    "in_progress": "🔄", 
                    "completed": "✅"
                }.get(task["status"], "⏳")
                
                context += f"{i}. {status_icon} {task['content']} ({task['status']})\n"
                
                # Add subtasks if any
                if task.get("subtasks"):
                    for subtask in task["subtasks"]:
                        if isinstance(subtask, dict):
                            subtask_content = subtask.get("content", str(subtask))
                        else:
                            subtask_content = str(subtask)
                        context += f"   • {subtask_content}\n"
            
            context += "\nRemember: Call task_update_status() when starting/completing tasks!\n"
            return context
            
        except Exception as e:
            logger.error(f"Error getting task context: {e}")
            return ""

# Create singleton instance
sqlite_task_manager = SQLiteTaskManager()