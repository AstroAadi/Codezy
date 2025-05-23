import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

export type EditorAction = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'find' | 'replace' | 'delete';

@Injectable({ providedIn: 'root' })
export class EditorActionsService {
  private actionSubject = new Subject<EditorAction>();
  action$ = this.actionSubject.asObservable();

  trigger(action: EditorAction) {
    this.actionSubject.next(action);
  }
}