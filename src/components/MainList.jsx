import React, { Component } from 'react';
import marked from 'marked';

export default class MainList extends Component {
  constructor(props) {
    super(props);

    this.state = {
      data: {},
    };
  }

  componentDidMount() {
    fetch('/api/v1/all')
      .then(response => response.json())
      .then(data => this.setState({ data }));
  }

  render() {
    const data = this.state.data;

    marked.setOptions({
      gfm: true,
      tables: true,
      breaks: true,
      pedantic: false,
      sanitize: true,
      smartLists: true,
      smartypants: false,
    });

    return (
      <div>
        <div>
          <a href="/edit/new" className="btn btn-warning">New</a>
        </div>

        <div className="card-deck">
          {data.length > 0 ? data.map(e =>
            <div className="card" id={`list_${e.id}`}>
              <div
                className="card-block list-preview"
                dangerouslySetInnerHTML={{ __html: marked(e.list) }}
              />
              <div className="card-footer">
                <a href="#" className="btn btn-primary btn-sm" style={{ cursor: 'not-allowed' }}>View</a>
                <a href={`/edit/${e.id}`} className="btn btn-success btn-sm">Edit</a>
                <a href={`/del/${e.id}`} className="btn btn-danger btn-sm">Delete</a>
              </div>
            </div>
          )
          : <div className="card">Loading</div>}
        </div>
      </div>
    );
  }
}
