import { Component, OnInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { CommonModule, ViewportScroller } from '@angular/common';
import { AuthService } from '../services/auth.service';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import {  NgForm } from '@angular/forms';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css'],
  imports: [FormsModule, CommonModule]
})
export class HomeComponent implements OnInit {
  onSendMessage(form: NgForm) {
    if (form.valid) {
      console.log('Form Submitted!', form.value);
      // Here you would typically send the form data to a server
      Swal.fire({
        icon: 'success',
        title: 'Message Sent',
        text: 'Your message has been successfully submitted.',
        confirmButtonColor: '#00c853'
      });
      form.reset();
    }

  }
  isLoggedIn: boolean = false;
  userName: string | null = null;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private viewportScroller: ViewportScroller,
    private authService: AuthService
  ) { }

  ngOnInit(): void {
    this.authService.user$.subscribe(user => {
      this.userName = user;
      this.isLoggedIn = !!user;
    });
  }

  goToPlatform() {
    alert("This system currently work for java.\nCreate class with the name as 'Main'")
    this.router.navigate(['/editor']);
  }

  goToLogin() {
    this.router.navigate(['/login']);
  }

  scrollToSection(sectionId: string): void {
    this.viewportScroller.scrollToAnchor(sectionId);
  }
}
