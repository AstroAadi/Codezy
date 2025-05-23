import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class UserFileService {
  private apiUrl = 'http://localhost:8081/api/files';

  constructor(private http: HttpClient) {}

  saveFile(fileName: string, codeContent: string): Observable<any> {
    const token = localStorage.getItem('token');
    return this.http.post(`${this.apiUrl}/save`, null, {
      params: { fileName, codeContent },
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
  }

  getFiles(): Observable<any[]> {
    return this.http.get<any[]>(this.apiUrl);
  }

  getFile(fileName: string): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/${fileName}`);
  }
}