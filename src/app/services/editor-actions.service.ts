import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

export type EditorAction = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'find' | 'replace' | 'delete';

export type AiOperation = 'replace' | 'insert' | 'delete' | 'insert_before';

export interface AiModification {
  operation: AiOperation;
  start_line: number;
  end_line: number;
  old_content?: string;
  new_content?: string;
}

export interface AiFileChangePayload {
  file: string;
  modifications: AiModification[];
}

@Injectable({ providedIn: 'root' })
export class EditorActionsService {
  private actionSubject = new Subject<EditorAction>();
  action$ = this.actionSubject.asObservable();

  // Stream carrying AI file change payloads to the editor
  private aiChangesSubject = new Subject<AiFileChangePayload[]>();
  aiChanges$ = this.aiChangesSubject.asObservable();

  trigger(action: EditorAction) {
    this.actionSubject.next(action);
  }

  applyAiChanges(payload: AiFileChangePayload[]) {
    this.aiChangesSubject.next(payload);
  }
}