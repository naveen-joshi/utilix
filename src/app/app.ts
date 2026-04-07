import { Component, ChangeDetectionStrategy } from '@angular/core';
import { Layout } from './layout/layout';

@Component({
  selector: 'app-root',
  imports: [Layout],
  template: `<app-layout />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App { }
