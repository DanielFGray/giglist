import React from 'react';
import { render } from 'react-dom';

import 'bootstrap/dist/css/bootstrap.min.css';

import MainList from './components/MainList';

const Init = () => (
  <div>
    <MainList />
  </div>
);

document.addEventListener('DOMContentLoaded', () => {
  render(<Init />, document.getElementById('main'));
});
