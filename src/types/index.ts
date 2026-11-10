import { Request } from 'express';

export interface UserTokenPayload {
  id: number;
  email: string;
  user_type: 'staff' | 'client' | 'lead';
  is_admin: number;
  first_name: string;
  last_name: string;
}

export interface AuthenticatedRequest extends Request {
  user?: UserTokenPayload;
}

export interface UserRecord {
  id: number;
  first_name: string;
  last_name: string;
  user_type: 'staff' | 'client' | 'lead';
  is_admin: number;
  role_id: number;
  email: string;
  password?: string | null;
  image?: string | null;
  status: 'active' | 'inactive';
  client_id: number;
  job_title: string;
  disable_login: number;
  note?: string | null;
  address?: string | null;
  phone?: string | null;
  gender?: 'male' | 'female' | 'other' | null;
  language: string;
  enable_web_notification: number;
  enable_email_notification: number;
  created_at?: string | null;
  deleted: number;
}

export interface AttendanceRecord {
  id: number;
  status: 'incomplete' | 'pending' | 'approved' | 'rejected' | 'deleted';
  user_id: number;
  in_time: string;
  out_time?: string | null;
  checked_by?: number | null;
  note?: string | null;
  checked_at?: string | null;
  reject_reason?: string | null;
  deleted: number;
}

export interface ProjectRecord {
  id: number;
  title: string;
  description?: string | null;
  project_type: 'client_project' | 'internal_project';
  start_date?: string | null;
  deadline?: string | null;
  client_id: number;
  created_date?: string | null;
  created_by: number;
  status: 'open' | 'completed' | 'hold' | 'canceled';
  status_id: number;
  labels?: string | null;
  price: number;
  deleted: number;
  client_name?: string;
  total_tasks?: number;
  completed_tasks?: number;
}

export interface TaskRecord {
  id: number;
  title: string;
  description?: string | null;
  project_id: number;
  project_title?: string;
  milestone_id: number;
  assigned_to: number;
  assigned_to_name?: string;
  deadline?: string | null;
  labels?: string | null;
  points: number;
  status: 'to_do' | 'in_progress' | 'done';
  status_id: number;
  status_title?: string;
  status_color?: string;
  priority_id: number;
  start_date?: string | null;
  collaborators?: string;
  created_date?: string | null;
  status_changed_at?: string | null;
  deleted: number;
}

export interface NotificationRecord {
  id: number;
  user_id: number;
  description: string;
  created_at: string;
  notify_to: string;
  read_by: string;
  event: string;
  project_id: number;
  task_id: number;
  deleted: number;
  is_read?: boolean;
}

export interface FileRecord {
  id: number;
  file_name: string;
  file_id?: string | null;
  service_type?: string | null;
  description?: string | null;
  file_size: number;
  created_at: string;
  project_id?: number;
  uploaded_by: number;
  uploaded_by_name?: string;
  folder_id: number;
  deleted: number;
}
